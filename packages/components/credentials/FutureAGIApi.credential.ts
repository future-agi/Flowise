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
            'Refer to <a target="_blank" href="https://docs.futureagi.com/docs/integrations">the Future AGI docs</a> for the API key, secret key and project name.'
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
                placeholder: 'default',
                description: 'Observe project the traces go to. The Analyse settings can override it per flow. Defaults to "default".',
                optional: true
            },
            {
                label: 'Hide Inputs',
                name: 'futureAgiHideInputs',
                type: 'boolean',
                description:
                    'Do not export prompts, input messages, tool arguments or any other input text. Same as FI_HIDE_INPUTS=true on the Flowise server.',
                optional: true
            },
            {
                label: 'Hide Outputs',
                name: 'futureAgiHideOutputs',
                type: 'boolean',
                description:
                    'Do not export model responses, tool results, retrieved documents or any other output text. Same as FI_HIDE_OUTPUTS=true on the Flowise server.',
                optional: true
            }
        ]
    }
}

module.exports = { credClass: FutureAGIApi }
