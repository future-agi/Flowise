import { INodeParams, INodeCredential } from '../src/Interface'

class FutureAGIApi implements INodeCredential {
    label: string
    name: string
    version: number
    description: string
    inputs: INodeParams[]

    constructor() {
        this.label = 'Future AGI API'
        this.name = 'futureAgiApi'
        this.version = 1.0
        this.description =
            'Refer to <a target="_blank" href="https://docs.futureagi.com/docs/integrations/flowise">the Future AGI guide</a> for the API key, secret key and project name.'
        this.inputs = [
            {
                label: 'API Key',
                name: 'futureAgiApiKey',
                type: 'password',
                placeholder: '<FUTUREAGI_API_KEY>'
            },
            {
                label: 'Secret Key',
                name: 'futureAgiSecretKey',
                type: 'password',
                placeholder: '<FUTUREAGI_SECRET_KEY>'
            },
            {
                label: 'Endpoint',
                name: 'futureAgiEndpoint',
                type: 'string',
                default: 'https://api.futureagi.com'
            },
            {
                label: 'Project',
                name: 'futureAgiProject',
                type: 'string',
                placeholder: 'default'
            }
        ]
    }
}

module.exports = { credClass: FutureAGIApi }
