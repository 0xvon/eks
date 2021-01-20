import * as cdk from '@aws-cdk/core';
import {
    Vpc,
    InstanceType,
    SecurityGroup,
    Port,
} from '@aws-cdk/aws-ec2';
import {
    Cluster,
    EndpointAccess,
    KubernetesVersion,
    AwsAuth,
} from '@aws-cdk/aws-eks';
import {
    Role,
    ServicePrincipal,
    AccountRootPrincipal,
    ManagedPolicy,
    PolicyStatement,
    User,
} from '@aws-cdk/aws-iam';
import {
    UpdatePolicy,
} from '@aws-cdk/aws-autoscaling';
import {
    Repository,
} from '@aws-cdk/aws-ecr';
import {
    LinuxBuildImage,
    BuildSpec,
    PipelineProject,
} from '@aws-cdk/aws-codebuild';
import {
    Artifact, Pipeline,
} from '@aws-cdk/aws-codepipeline';
import {
    GitHubSourceAction,
    CodeBuildAction,
} from '@aws-cdk/aws-codepipeline-actions';
import { appLabel, deployment, secret, service, stringData, ContainerEnv, Obj } from './manifest';
import { users } from '../config';

interface EKSStackProps extends cdk.StackProps {
    appName: string
    vpc: Vpc
    clusterEndpoint: string
    dbname: string
    rdsUsername: string
    rdsPassword: string
    awsAccessKeyId: string,
    awsSecretAccessKey: string,
    acmCertificateArn: string,
    rdsSecurityGroupId: string,
    awsRegion: string,
    githubOwner: string
    githubRepo: string
    githubBranch: string
}

export class EKSStack extends cdk.Stack {
    eks: Cluster;
    rdsSecurityGroupId: string;
    clusterEndpoint: string;
    dbname: string;
    appName: string;
    rdsUsername: string;
    rdsPassword: string;
    awsAccessKeyId: string;
    awsSecretAccessKey: string;
    awsRegion: string;

    constructor(scope: cdk.Construct, id: string, props: EKSStackProps) {
        super(scope, id, props);

        this.appName = props.appName;
        this.rdsSecurityGroupId = props.rdsSecurityGroupId;
        this.clusterEndpoint = props.clusterEndpoint;
        this.dbname = props.dbname;
        this.rdsUsername = props.rdsUsername;
        this.rdsPassword = props.rdsPassword;
        this.awsAccessKeyId = props.awsAccessKeyId;
        this.awsSecretAccessKey = props.awsSecretAccessKey;
        this.awsRegion = props.awsRegion;

        const instanceType = 'm5.large';
        const minCapacity = 1;
        const maxCapacity = 10;

        const eksRole = new Role(this, `${props.appName}-EKSRole`, {
            assumedBy: new ServicePrincipal('eks.amazonaws.com'),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),
                ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSServicePolicy'),
            ],
        });
        eksRole.addToPolicy(
            new PolicyStatement({
                resources: ['*'],
                actions: [
                    'elasticloadbalancing:*',
                    'ec2:CreateSecurityGroup',
                    'ec2:Describe*',
                ],
            }),
        );
        const adminRole = new Role(this, `${props.appName}-EKSAdminRole`, {
            assumedBy: new AccountRootPrincipal(),
        });

        const ecrRepository = new Repository(this, `${props.appName}-ECR`, {
            repositoryName: `${props.appName}`,
        });

        const cluster = new Cluster(this, `${props.appName}-cluster`, {
            vpc: props.vpc,
            vpcSubnets: [
                {
                    subnets: props.vpc.publicSubnets,
                },
            ],
            endpointAccess: EndpointAccess.PUBLIC,
            defaultCapacity: 0,
            role: eksRole,
            mastersRole: adminRole,
            version: KubernetesVersion.V1_18,
            clusterName: `${props.appName}-cluster`,
        });
        const ng = cluster.addNodegroupCapacity(`${props.appName}-capacity`, {
            desiredSize: minCapacity,
            subnets: {
                subnets: props.vpc.publicSubnets,
            },
            instanceType: new InstanceType(instanceType),
        });
        ng.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEC2RoleforSSM"));
        ng.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryPowerUser"));
        const [ newStringData, newContainerEnvironments ] = this.injectContainerEnv();
        cluster.addManifest(
            `${props.appName}-pod`,
            service(props.acmCertificateArn),
            secret(newStringData),
            deployment({
                imageUrl: ecrRepository.repositoryUri,
                containerEnvironments: newContainerEnvironments,
            }),
        );
        const awsAuth = new AwsAuth(this, `${props.appName}-AwsAuth`, {
            cluster: cluster,
        });
        awsAuth.addRoleMapping(ng.role, {
            groups: ["system:bootstrappers", "system:nodes"],
            username: "system:node:{{EC2PrivateDNSName}}",
        });
        awsAuth.addMastersRole(
            adminRole,
            adminRole.roleName
        );
        users.forEach(user => {
            awsAuth.addUserMapping(User.fromUserName(this, user, user), {
                username: user,
                groups: ["system:masters"],
            });
        });
        this.eks = cluster;
        this.injectSecurityGroup(cluster.clusterSecurityGroupId);

        cluster.addAutoScalingGroupCapacity(`${props.appName}-nodes`, {
            autoScalingGroupName: `${props.appName}-EKS-ASG`,
            instanceType: new InstanceType(instanceType),
            minCapacity: minCapacity,
            maxCapacity: maxCapacity,
            vpcSubnets: {
                subnets: props.vpc.publicSubnets,
            },
            updatePolicy: UpdatePolicy.rollingUpdate(),
        });

        const githubToken = cdk.SecretValue.secretsManager('GITHUB_TOKEN')

        const sourceOutput = new Artifact();
        const sourceAction = new GitHubSourceAction({
            actionName: `${props.appName}-SourceAction`,
            owner: props.githubOwner,
            repo: props.githubRepo,
            oauthToken: githubToken,
            output: sourceOutput,
            branch: props.githubBranch,
        });

        const codeBuildProject = new PipelineProject(this, `${props.appName}-CodeBuildProj`, {
            projectName: `${props.appName}-CodeBuildProj`,
            environment: {
                buildImage: LinuxBuildImage.AMAZON_LINUX_2_3,
                privileged: true,
            },
            environmentVariables: {
                'CLUSTER_NAME': {
                    value: `${cluster.clusterName}`,
                },
                'ECR_REPO_URI': {
                    value: `${ecrRepository.repositoryUri}`,
                },
                'APP_NAME': {
                    value: `${appLabel.app}`,
                },
                'ROLE_ARN': {
                    value: `${adminRole.roleArn}`,
                },
                'DOCKER_BUILDKIT': {
                    value: '1',
                },
            },
            buildSpec: BuildSpec.fromObject({
                version: "0.2",
                phases: {
                    pre_build: {
                        commands: [
                            'env',
                            'export TAG=latest',
                            '$(aws ecr get-login --no-include-email)',
                            'aws eks update-kubeconfig --name $CLUSTER_NAME --role-arn $ROLE_ARN',
                            'kubectl get no',
                        ],
                    },
                    build: {
                        commands: [
                            'docker build -t $ECR_REPO_URI:$TAG .',
                            'docker push $ECR_REPO_URI:$TAG',
                        ],
                    },
                    post_build: {
                        commands: [
                            'kubectl get no',
                            'kubectl set image deployment $APP_NAME $APP_NAME=$ECR_REPO_URI:$TAG',
                        ],
                    },
                },
            })
        });
        ecrRepository.grantPullPush(codeBuildProject.role!);
        cluster.awsAuth.addMastersRole(codeBuildProject.role!);
        codeBuildProject.addToRolePolicy(new PolicyStatement({
            actions: ['eks:DescribeCluster'],
            resources: [`${cluster.clusterArn}`],
        }));
        codeBuildProject.addToRolePolicy(new PolicyStatement({
            actions: [
                'ecr:GetAuthorizationToken',
                'ecr:BatchCheckLayerAvailability',
                'ecr:CompleteLayerUpload',
                'ecr:InitiateLayerUpload',
                'ecr:PutImage',
                'ecr:UploadLayerPart',
                'sts:AssumeRole',
            ],
            resources: ['*'],
        }));

        const buildAction = new CodeBuildAction({
            actionName: `${props.appName}-BuildAction`,
            project: codeBuildProject,
            input: sourceOutput,
            outputs: [new Artifact()],
        })

        const pipeline = new Pipeline(this, `${props.appName}-Pipeline`, {
            pipelineName: `${props.appName}-Pipeline`,
            stages: [
                {
                    stageName: 'Source',
                    actions: [sourceAction],
                },
                {
                    stageName: 'Build',
                    actions: [buildAction],
                },
            ],
        });
    }

    private injectContainerEnv(): [Obj, ContainerEnv[]] {
        var newStringData = stringData;

        newStringData["DATABASE_URL"] = `mysql://${this.rdsUsername}:${this.rdsPassword}@${this.clusterEndpoint}:3306/${this.dbname}`;
        newStringData["AWS_ACCESS_KEY_ID"] = this.awsAccessKeyId;
        newStringData["AWS_SECRET_ACCESS_KEY"] = this.awsSecretAccessKey;
        newStringData["AWS_REGION"] = this.awsRegion;

        const containerEnvironments: ContainerEnv[] = Object.keys(newStringData).map(key => {
            return {
                name: key,
                valueFrom: {
                    secretKeyRef: {
                        name: 'api',
                        key: key,
                    },
                },
            };
        })

        return [ newStringData, containerEnvironments ];
    }

    injectSecurityGroup(appSGId: string) {
        let rdsSecurityGroup = SecurityGroup.fromSecurityGroupId(this, `${this.appName}-DB-SG`, this.rdsSecurityGroupId);

        rdsSecurityGroup.addIngressRule(
            SecurityGroup.fromSecurityGroupId(this, `APP-SG`, appSGId),
            Port.tcp(3306),
        );
    };
}
