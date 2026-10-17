// Endpoint, header, privacy and span-scrubbing contract for the Future AGI tracer.
// Kept free of the components import tree so the contract can be tested
// without compiling the whole package.
import { homedir, hostname, userInfo } from 'os'
import type { Attributes, AttributeValue, Context, Span, SpanOptions, Tracer } from '@opentelemetry/api'
import type { ExportResult } from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'

const COLLECTOR_PATH = '/tracer/v1/traces'

function collectorEndpoint(baseUrl: string): string {
    const parsed = new URL(baseUrl)
    const path = parsed.pathname.replace(/\/$/, '').replace(/\/tracer\/v1\/traces$/, '')
    return `${parsed.protocol}//${parsed.host}${path}${COLLECTOR_PATH}`
}

function exporterHeaders(apiKey: string, secretKey: string): Record<string, string> {
    return {
        'X-Api-Key': apiKey || '',
        'X-Secret-Key': secretKey || ''
    }
}

function resolveProjectName(analyticProject?: string, credentialProject?: string): string {
    return analyticProject || credentialProject || 'default'
}

// Privacy follows the traceAI TraceConfig convention: inputs and outputs are captured by
// default and hidden with FI_HIDE_INPUTS / FI_HIDE_OUTPUTS (server-wide) or the credential's
// Hide Inputs / Hide Outputs switches (per credential). Either source can only hide, never reveal.
interface FutureAGIPrivacy {
    hideInputs: boolean
    hideOutputs: boolean
}

function isEnabled(value: unknown): boolean {
    if (value === true) return true
    if (typeof value !== 'string') return false
    return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function resolvePrivacy(
    credential: { hideInputs?: unknown; hideOutputs?: unknown },
    env: Record<string, string | undefined> = process.env
): FutureAGIPrivacy {
    return {
        hideInputs: isEnabled(credential.hideInputs) || isEnabled(env.FI_HIDE_INPUTS),
        hideOutputs: isEnabled(credential.hideOutputs) || isEnabled(env.FI_HIDE_OUTPUTS)
    }
}

// OpenInference attribute keys that carry prompt or user content.
const INPUT_ATTRIBUTE_PATTERNS = [
    /^input\./,
    /^llm\.input_messages\./,
    /^llm\.prompts\b/,
    /^llm\.prompt_template\.variables\b/,
    /^embedding\.embeddings\./
]
const OUTPUT_ATTRIBUTE_PATTERNS = [/^output\./, /^llm\.output_messages\./, /^retrieval\.documents\./, /^reranker\./]
// Attributes that hold error text. They are kept, but scrubbed of stack traces and local identifiers.
const ERROR_TEXT_ATTRIBUTES = ['error.value', 'exception.message']

function localIdentifiers(): { value: string; replacement: string }[] {
    const ids: { value: string; replacement: string }[] = []
    try {
        const home = homedir()
        if (home && home.length > 1) ids.push({ value: home, replacement: '~' })
    } catch {
        // no home directory
    }
    try {
        const name = userInfo().username
        if (name && name.length > 2) ids.push({ value: name, replacement: '<user>' })
    } catch {
        // no user entry
    }
    try {
        const host = hostname()
        if (host && host.length > 2) ids.push({ value: host, replacement: '<host>' })
    } catch {
        // no hostname
    }
    return ids
}

const LOCAL_IDENTIFIERS = localIdentifiers()

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// LangChain's tracer appends `\n\n${error.stack}` to every error message, and stacks carry
// absolute file paths (and with them the OS user name). Keep the message, drop the stack, and
// mask home directories, the local user and host names, and e-mail addresses.
function sanitizeErrorText(text: string): string {
    if (typeof text !== 'string' || !text) return text
    const lines = text.split('\n')
    const firstFrame = lines.findIndex((line) => /^\s+at\s/.test(line))
    let kept = firstFrame >= 0 ? lines.slice(0, firstFrame) : lines
    if (firstFrame > 0) {
        // The line before the first frame is the stack header ("Error: <message>").
        // Drop it when a message precedes it, which is LangChain's "<message>\n\n<stack>" shape.
        const beforeHeader = kept.slice(0, -1)
        if (beforeHeader.some((line) => line.trim() !== '')) kept = beforeHeader
    }
    let out = kept.join('\n').trim()
    out = out.replace(/(?:\/Users|\/home)\/[^/\s'"`:)]+/g, '~').replace(/[A-Za-z]:\\Users\\[^\\\s'"`:)]+/g, '~')
    for (const { value, replacement } of LOCAL_IDENTIFIERS) {
        // The home directory is a path prefix; user and host names only match as whole words.
        const pattern = replacement === '~' ? escapeRegExp(value) : `\\b${escapeRegExp(value)}\\b`
        out = out.replace(new RegExp(pattern, 'g'), replacement)
    }
    out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    return out
}

function scrubAttributes(attributes: Attributes, privacy: FutureAGIPrivacy): Attributes {
    const out: Attributes = {}
    for (const [key, value] of Object.entries(attributes || {})) {
        if (privacy.hideInputs && INPUT_ATTRIBUTE_PATTERNS.some((pattern) => pattern.test(key))) continue
        if (privacy.hideOutputs && OUTPUT_ATTRIBUTE_PATTERNS.some((pattern) => pattern.test(key))) continue
        if (key === 'exception.stacktrace') continue
        out[key] = ERROR_TEXT_ATTRIBUTES.includes(key) && typeof value === 'string' ? sanitizeErrorText(value) : (value as AttributeValue)
    }
    return out
}

// Returns a read-only view of the span with content hidden per the privacy settings and
// error text scrubbed. The original span is left untouched.
function scrubSpan(span: ReadableSpan, privacy: FutureAGIPrivacy): ReadableSpan {
    const status = span.status?.message ? { ...span.status, message: sanitizeErrorText(span.status.message) } : span.status
    const events = (span.events || []).map((event) =>
        event.attributes ? { ...event, attributes: scrubAttributes(event.attributes, privacy) } : event
    )
    return Object.create(span, {
        attributes: { value: scrubAttributes(span.attributes, privacy), enumerable: true },
        status: { value: status, enumerable: true },
        events: { value: events, enumerable: true }
    })
}

const EXPORT_WARNING_INTERVAL_MS = 60000

// Wraps the OTLP exporter so every span is scrubbed before it leaves the process, and so a
// failed export (wrong keys, unknown project, collector down) is logged instead of silently dropped.
class FutureAGISpanExporter implements SpanExporter {
    private lastWarning = 0

    constructor(
        private readonly inner: SpanExporter,
        private readonly privacy: FutureAGIPrivacy,
        private readonly warn: (message: string) => void = (message) => console.warn(message)
    ) {}

    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
        let scrubbed: ReadableSpan[]
        try {
            scrubbed = spans.map((span) => scrubSpan(span, this.privacy))
        } catch (err) {
            // Never export unscrubbed spans: drop the batch instead.
            resultCallback({ code: 1, error: err as Error })
            return
        }
        this.inner.export(scrubbed, (result) => {
            if (result.code !== 0) this.reportFailure(spans.length, result.error)
            resultCallback(result)
        })
    }

    // At most one line a minute per exporter, so a down collector cannot flood the Flowise log.
    private reportFailure(count: number, error?: Error): void {
        const now = Date.now()
        if (now - this.lastWarning < EXPORT_WARNING_INTERVAL_MS) return
        this.lastWarning = now
        const reason = error?.message ? `: ${sanitizeErrorText(error.message).split('\n')[0].slice(0, 300)}` : ''
        this.warn(
            `[Future AGI] dropped ${count} span(s), export failed${reason}. Predictions are not affected. ` +
                'Check the API key, secret key, endpoint and project of the Future AGI credential.'
        )
    }

    shutdown(): Promise<void> {
        return this.inner.shutdown()
    }

    forceFlush(): Promise<void> {
        return this.inner.forceFlush ? this.inner.forceFlush() : Promise.resolve()
    }
}

export type { FutureAGIPrivacy }

// Session, user and flow attributes stamped on every span of a run.
function runAttributes(run: { sessionId?: string; userId?: unknown; chatflowId?: string }): Attributes {
    const attributes: Attributes = {}
    if (run.sessionId) attributes['session.id'] = run.sessionId
    if (run.userId !== undefined && run.userId !== null && String(run.userId) !== '') attributes['user.id'] = String(run.userId)
    if (run.chatflowId) attributes['flowise.chatflow_id'] = run.chatflowId
    return attributes
}

// A tracer that sets the given attributes on every span it starts, so one prediction's spans
// all carry its session and user without touching the shared provider.
function tracerWithAttributes(tracer: Tracer, attributes: Attributes): Tracer {
    if (!Object.keys(attributes).length) return tracer
    return {
        startSpan(name: string, options?: SpanOptions, context?: Context): Span {
            const span = tracer.startSpan(name, options, context)
            span.setAttributes(attributes)
            return span
        },
        startActiveSpan(name: string, ...args: unknown[]): unknown {
            const fn = args.pop() as (span: Span) => unknown
            return (tracer.startActiveSpan as (...a: unknown[]) => unknown)(name, ...args, (span: Span) => {
                span.setAttributes(attributes)
                return fn(span)
            })
        }
    } as Tracer
}

export {
    collectorEndpoint,
    exporterHeaders,
    COLLECTOR_PATH,
    resolveProjectName,
    resolvePrivacy,
    sanitizeErrorText,
    scrubAttributes,
    scrubSpan,
    FutureAGISpanExporter,
    runAttributes,
    tracerWithAttributes
}
