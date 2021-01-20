import * as cdk from '@aws-cdk/core';
import {
    Vpc,
    SecurityGroup,
    Port,
} from '@aws-cdk/aws-ec2';
import {
    DatabaseCluster,
    DatabaseClusterEngine,
    AuroraMysqlEngineVersion,
    Credentials,
    ParameterGroup,
} from '@aws-cdk/aws-rds';

interface RDSStackProps extends cdk.StackProps {
    appName: string
    vpc: Vpc
    dbname: string
    username: string
    password: string
}

export class RDSStack extends cdk.Stack {
    rds: DatabaseCluster;
    rdsSecurityGroupId: string;

    constructor(scope: cdk.Construct, id: string, props: RDSStackProps) {
        super(scope, id, props);
        const rdsSecurityGroup = new SecurityGroup(this, `${props.appName}-DB-SG`, {
            allowAllOutbound: true,
            vpc: props.vpc,
            securityGroupName: `${props.appName}-DB-SG`,
        });
        this.rdsSecurityGroupId = rdsSecurityGroup.securityGroupId;

        const rdsParameterGroup = new ParameterGroup(this, `${props.appName}-PG`, {
            engine: DatabaseClusterEngine.auroraMysql({
                version: AuroraMysqlEngineVersion.VER_2_08_1,
            }),
            parameters: {
                character_set_server: 'utf8mb4',
                character_set_database: 'utf8mb4',
                character_set_client: 'utf8mb4',
                character_set_results: 'utf8mb4',
                collation_server: 'utf8mb4_bin',
                log_warnings: '1',
                performance_schema: '1',
                log_queries_not_using_indexes: '0',
                net_write_timeout: '120',
                max_allowed_packet: '67108864',
                server_audit_logging: '1',
                time_zone: 'Asia/Tokyo',
                slow_query_log: '1',
                long_query_time: '1',
                innodb_print_all_deadlocks: '1',
            },
        });

        const cluster = new DatabaseCluster(this, `${props.appName}-DB-cluster`, {
            engine: DatabaseClusterEngine.auroraMysql({
                version: AuroraMysqlEngineVersion.VER_2_08_1,
            }),
            credentials: Credentials.fromPassword(props.username, new cdk.SecretValue(props.password)),
            defaultDatabaseName: props.dbname,
            instanceProps: {
                vpcSubnets: {
                    subnets: props.vpc.isolatedSubnets,
                },
                vpc: props.vpc,
                securityGroups: [rdsSecurityGroup],
                autoMinorVersionUpgrade: true,
                
            },
            cloudwatchLogsExports: [
                'slowquery',
                'error',
            ],
            parameterGroup: rdsParameterGroup,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        this.rds = cluster;
    }
}
