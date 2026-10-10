import { collectorEndpoint, exporterHeaders, resolveProjectName } from './futureagi'

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
