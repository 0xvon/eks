import environment from './environment.json';
import { SSMSecret } from '../typing';

export interface Obj {
    [index: string]: string;
}
export const stringData: Obj = {}
environment.Secrets.map(function(secret: SSMSecret) { stringData[secret.name]=secret.value });

interface KeyRef {
    name: string;
    key: string;
    optional?: boolean;
}
interface ValueFrom {
    secretKeyRef: KeyRef;
}
export interface ContainerEnv {
    name: string;
    valueFrom: ValueFrom;
}

export const appLabel = {
    app: 'api',
};

export const secret = (stringData: Obj) => {
    return {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: appLabel.app },
        stringData: stringData,
    };
};

interface DeploymentConfig {
    imageUrl: string,
    containerEnvironments: ContainerEnv[],
};

export const deployment = (config: DeploymentConfig) => {
    return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: appLabel.app },
        spec: {
            replicas: 1,
            selector: { matchLabels: appLabel },
            template: {
                metadata: { labels: appLabel },
                spec: {
                    restartPolicy: 'Always',
                    containers: [
                        {
                            name: appLabel.app,
                            image: `${config.imageUrl}:latest`,
                            ports: [{ containerPort: 8080 }],
                            env: config.containerEnvironments,
                        },
                    ],
                },
            },
        },
    };
};

export const service = (acmCertificateArn: string) => {
    return { 
        apiVersion: 'v1',
        kind: 'Service',
        metadata: {
            name: appLabel.app,
            annotations: {
                'service.beta.kubernetes.io/aws-load-balancer-ssl-cert': acmCertificateArn,
                'service.beta.kubernetes.io/aws-load-balancer-backend-protocol': 'http',
                'service.beta.kubernetes.io/aws-load-balancer-ssl-ports': 'https',
            },
        },
        spec: {
            type: 'LoadBalancer',
            ports: [
                {
                    name: 'https',
                    protocol: 'TCP',
                    port: 443,
                    targetPort: 8080
                },
                {
                    name: 'http',
                    protocol: 'TCP',
                    port: 80,
                    targetPort: 8080
                },
            ],
            selector: appLabel,
        },
    };
};
