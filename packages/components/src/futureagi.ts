// Endpoint and header contract for the Future AGI tracer.
// Kept free of the components import tree so the contract can be tested
// without compiling the whole package.

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

export { collectorEndpoint, exporterHeaders, COLLECTOR_PATH, resolveProjectName }
