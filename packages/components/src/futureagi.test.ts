import { collectorEndpoint, exporterHeaders } from './futureagi'

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
})
