import { homedir, userInfo } from 'os'
import {
    collectorEndpoint,
    exporterHeaders,
    resolveProjectName,
    resolvePrivacy,
    sanitizeErrorText,
    scrubAttributes,
    scrubSpan,
    runAttributes,
    tracerWithAttributes,
    FutureAGISpanExporter
} from './futureagi'

describe('Future AGI tracer contract', () => {
    const cases: [string, string][] = [
        ['https://api.futureagi.com', 'https://api.futureagi.com/tracer/v1/traces'],
        ['https://api.futureagi.com/tracer/v1/traces', 'https://api.futureagi.com/tracer/v1/traces'],
        ['https://collector.example.com/base', 'https://collector.example.com/base/tracer/v1/traces']
    ]

    it.each(cases)('baseUrl %s - exporterUrl %s', (input, expected) => {
        expect(collectorEndpoint(input)).toBe(expected)
    })

    it('sends the collector header names and not the Phoenix ones', () => {
        const headers = exporterHeaders('k', 's')
        expect(headers).toEqual({ 'X-Api-Key': 'k', 'X-Secret-Key': 's' })
        expect(headers['api_key']).toBeUndefined()
        expect(headers['authorization']).toBeUndefined()
    })

    it('uses the credential project when the analytic node has none', () => {
        expect(resolveProjectName(undefined, 'proj')).toBe('proj')
        expect(resolveProjectName('', 'proj')).toBe('proj')
        expect(resolveProjectName('from-node', 'from-cred')).toBe('from-node')
        expect(resolveProjectName(undefined, undefined)).toBe('default')
    })
})

describe('Future AGI privacy and span scrubbing', () => {
    // LangChain's BaseTracer stores `${error.message}\n\n${error.stack}` as the run error.
    const langchainError = [
        '400 unknown provider for model no-such-model',
        '',
        'Error: 400 unknown provider for model no-such-model',
        `    at APIError.generate (${homedir()}/flowise/node_modules/openai/core/error.js:45:20)`,
        '    at OpenAI.makeStatusError (/home/runner/app/node_modules/openai/client.js:165:32)'
    ].join('\n')

    it('keeps the message and drops the stack trace and local paths', () => {
        const out = sanitizeErrorText(langchainError)
        expect(out).toBe('400 unknown provider for model no-such-model')
        expect(out).not.toContain(homedir())
        expect(out).not.toContain(' at ')
    })

    it('keeps a bare stack header when there is no separate message', () => {
        expect(sanitizeErrorText('TypeError: boom\n    at x (/home/a/b.js:1:1)')).toBe('TypeError: boom')
    })

    it('masks home directories, the local user name and e-mail addresses in error text', () => {
        const user = userInfo().username
        const out = sanitizeErrorText(`ENOENT: no such file '${homedir()}/secret.txt' for ${user}, contact ops@example.com, /home/bob/x`)
        expect(out).toContain("'~/secret.txt'")
        expect(out).not.toContain(homedir())
        expect(out).not.toMatch(new RegExp(`\\b${user}\\b`))
        expect(out).toContain('<email>')
        expect(out).toContain('~/x')
    })

    it('captures content by default and hides it with the credential switches or FI_HIDE_* env vars', () => {
        expect(resolvePrivacy({}, {})).toEqual({ hideInputs: false, hideOutputs: false })
        expect(resolvePrivacy({ hideInputs: true }, {})).toEqual({ hideInputs: true, hideOutputs: false })
        expect(resolvePrivacy({ hideOutputs: 'true' }, {})).toEqual({ hideInputs: false, hideOutputs: true })
        expect(resolvePrivacy({}, { FI_HIDE_INPUTS: 'true', FI_HIDE_OUTPUTS: '1' })).toEqual({ hideInputs: true, hideOutputs: true })
        // The env var can only hide; a credential set to false does not reveal.
        expect(resolvePrivacy({ hideInputs: false }, { FI_HIDE_INPUTS: 'true' }).hideInputs).toBe(true)
        expect(resolvePrivacy({ hideInputs: 'false' }, { FI_HIDE_INPUTS: 'false' }).hideInputs).toBe(false)
    })

    const contentAttributes: Record<string, string | number> = {
        'openinference.span.kind': 'LLM',
        'input.value': 'MARKER prompt',
        'input.mime_type': 'text/plain',
        'llm.input_messages.0.message.content': 'MARKER prompt',
        'llm.prompt_template.variables': '{"q":"MARKER"}',
        'output.value': 'MARKER answer',
        'llm.output_messages.0.message.content': 'MARKER answer',
        'retrieval.documents.0.document.content': 'MARKER doc',
        'llm.model_name': 'gpt-test',
        'llm.token_count.total': 6,
        'session.id': 'chat-1',
        'error.value': langchainError
    }

    it('passes content through by default but still scrubs error text', () => {
        const out = scrubAttributes(contentAttributes, { hideInputs: false, hideOutputs: false })
        expect(out['input.value']).toBe('MARKER prompt')
        expect(out['output.value']).toBe('MARKER answer')
        expect(out['error.value']).toBe('400 unknown provider for model no-such-model')
    })

    it('removes every input and output attribute when hidden', () => {
        const out = scrubAttributes(contentAttributes, { hideInputs: true, hideOutputs: true })
        expect(JSON.stringify(out)).not.toContain('MARKER')
        expect(out).toEqual({
            'openinference.span.kind': 'LLM',
            'llm.model_name': 'gpt-test',
            'llm.token_count.total': 6,
            'session.id': 'chat-1',
            'error.value': '400 unknown provider for model no-such-model'
        })
    })

    it('scrubs a span view without touching the original span', () => {
        const original = {
            name: 'ChatOpenAI',
            attributes: { 'input.value': 'MARKER' },
            status: { code: 2, message: langchainError },
            events: [{ name: 'exception', attributes: { 'exception.message': 'boom', 'exception.stacktrace': langchainError } }],
            spanContext() {
                return { traceId: 't', spanId: 's' }
            }
        }
        const view: any = scrubSpan(original as any, { hideInputs: true, hideOutputs: false })
        expect(view.name).toBe('ChatOpenAI')
        expect(view.spanContext()).toEqual({ traceId: 't', spanId: 's' })
        expect(view.attributes).toEqual({})
        expect(view.status).toEqual({ code: 2, message: '400 unknown provider for model no-such-model' })
        expect(view.events[0].attributes).toEqual({ 'exception.message': 'boom' })
        expect(original.attributes).toEqual({ 'input.value': 'MARKER' })
    })

    it('hands scrubbed spans to the OTLP exporter', () => {
        const inner = { export: jest.fn((_spans, done) => done({ code: 0 })), shutdown: jest.fn() }
        const exporter = new FutureAGISpanExporter(inner as any, { hideInputs: false, hideOutputs: true })
        const done = jest.fn()
        exporter.export([{ attributes: { 'output.value': 'MARKER', 'input.value': 'q' }, status: { code: 0 }, events: [] } as any], done)
        expect((inner.export.mock.calls[0] as any)[0][0].attributes).toEqual({ 'input.value': 'q' })
        expect(done).toHaveBeenCalledWith({ code: 0 })
    })

    it('logs a failed export at most once a minute, without secrets or paths', () => {
        const inner = {
            export: jest.fn((_spans, done) => done({ code: 1, error: new Error(`Unauthorized\n    at x (${homedir()}/a.js:1:1)`) })),
            shutdown: jest.fn()
        }
        const warn = jest.fn()
        const exporter = new FutureAGISpanExporter(inner as any, { hideInputs: false, hideOutputs: false }, warn)
        const done = jest.fn()
        const span = { attributes: {}, status: { code: 0 }, events: [] } as any
        exporter.export([span, span], done)
        exporter.export([span], done)
        expect(done).toHaveBeenCalledTimes(2)
        expect(done).toHaveBeenLastCalledWith(expect.objectContaining({ code: 1 }))
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0][0]).toContain('dropped 2 span(s), export failed: Unauthorized')
        expect(warn.mock.calls[0][0]).not.toContain(homedir())
    })

    it('builds session, user and flow attributes only from values that exist', () => {
        expect(runAttributes({ sessionId: 'chat-1', userId: 'user-42', chatflowId: 'flow-1' })).toEqual({
            'session.id': 'chat-1',
            'user.id': 'user-42',
            'flowise.chatflow_id': 'flow-1'
        })
        expect(runAttributes({ sessionId: 'chat-1', userId: '' })).toEqual({ 'session.id': 'chat-1' })
        expect(runAttributes({})).toEqual({})
    })

    it('stamps the run attributes on every span the wrapped tracer starts', () => {
        const span = { setAttributes: jest.fn() }
        const tracer = { startSpan: jest.fn(() => span), startActiveSpan: jest.fn((_name, fn) => fn(span)) }
        const wrapped: any = tracerWithAttributes(tracer as any, { 'session.id': 'chat-1' })
        expect(wrapped.startSpan('a')).toBe(span)
        expect(wrapped.startActiveSpan('b', (s: any) => s)).toBe(span)
        expect(span.setAttributes).toHaveBeenCalledTimes(2)
        expect(span.setAttributes).toHaveBeenCalledWith({ 'session.id': 'chat-1' })
        expect(tracerWithAttributes(tracer as any, {})).toBe(tracer)
    })
})
