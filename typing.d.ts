export interface SSMSecret {
    name: string;
    value: string;
}

declare module '*/environment.json' {
    interface Environment {
        Secrets: SSMSecret[];
    }

    const env: Environment;
    export default env;
}