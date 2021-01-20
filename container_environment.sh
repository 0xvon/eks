#!bin/sh

aws ssm get-parameters-by-path \
    --path /${APP_NAME}/ \
    --with-decryption \
    --query "{Secrets:Parameters[*].{name:Name,value:Value}}" \
    --region ap-northeast-1 \
    --output json | \
    jq --arg replace /${APP_NAME}/ 'walk(if type == "object" and has("name") then .name |= gsub($replace;"") else . end)' \
    > ./lib/environment.json
