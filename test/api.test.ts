import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as VPC from '../lib/vpc';
import * as RDS from '../lib/rds';
import * as EKS from '../lib/eks';

test('Empty Stack', () => {
    const app = new cdk.App();

    const vpcStack = new VPC.VPCStack(app, 'MyTestVPCStack', {
        appName: 'sample',
    });
    expectCDK(vpcStack).to(matchTemplate({
        Resources: {},
    }, MatchStyle.EXACT));

    const rdsStack = new RDS.RDSStack(app, 'MyTestRDSStack', {
        appName: 'sample',
        dbname: 'dbname',
        username: 'username',
        password: 'hoge',
        vpc: vpcStack.vpc,
        env: {
            region: 'ap-northeast-1',
        },
    });

    const eksStack = new EKS.EKSStack(app, 'MyTestEKSStack', {
        appName: 'sample',
        vpc: vpcStack.vpc,
        rdsSecurityGroupId: rdsStack.rdsSecurityGroupId,
        clusterEndpoint: rdsStack.rds.clusterEndpoint.hostname,
        dbname: 'dbname',
        rdsUsername: 'username',
        rdsPassword: 'hoge',
        awsAccessKeyId: 'hoge',
        awsSecretAccessKey: 'hoge',
        acmCertificateArn: 'arn:hoge',
        awsRegion: 'ap-northeast-1',
        githubOwner: 'hoge',
        githubRepo: 'hoge',
        githubBranch: 'hoge',
        env: {
            region: 'ap-northeast-1',
        },
    });
    expectCDK(eksStack).to(matchTemplate({
        Resources: {},
    }, MatchStyle.EXACT));
});
