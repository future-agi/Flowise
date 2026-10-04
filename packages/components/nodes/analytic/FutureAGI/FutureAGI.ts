import { INode, INodeParams } from '../../../src/Interface'

class FutureAGI_Analytic implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs?: INodeParams[]
    credential: INodeParams

    constructor() {
        this.label = 'Future AGI'
        this.name = 'futureAgi'
        this.version = 1.0
        this.type = 'FutureAGI'
        this.icon = ''
        this.category = 'Analytic'
        this.baseClasses = [this.type]
        this.description = 'Send traces to Future AGI. Self-hosted Flowise only.'
        this.inputs = []
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['futureAgiApi']
        }
    }
}

module.exports = { nodeClass: FutureAGI_Analytic }
