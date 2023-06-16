import fetch from 'node-fetch'

/*
* Bot离线通知
* 离线时推送至企业微信，并每小时持续进行推送
* 配置企业微信参数后，可使用 #发送企业微信 命令进行测试
*/

// 每小时持续推送，默认启用
const enableTask = true
const pushTime = '0 0 * * * ?'

// 企业微信参数
const corpsecret = 'DlN1Ws******************eRkoes'
const corpid = 'wwb************2b8'
const agentid = 1000004

// 消息标题
const title = '【Yunzai-Bot】'

let online = true
Bot.on("system.online", async (e) => {
    online = true
})

Bot.on("system.offline", async (e) => {
    online = false
    logger.info(e.message)
    await wechatworkapp(e.message)
})

async function wechatworkapp(msg) {
    let url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpid}&corpsecret=${corpsecret}`
    let { access_token, errmsg } = await fetch(url).then(res => res.json())
    if (!access_token) {
        logger.info('[企业微信] 获取access_token失败: ' + errmsg)
        return
    }

    let res
    try {
        res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${access_token}`, {
            method: 'post',
            body: JSON.stringify({
                "touser": "@all",
                "msgtype": "text",
                "agentid": agentid,
                "text": {
                    "content": `${title}\n${msg}`
                }
            }),
            headers: {
                'Content-type': 'application/json'
            }
        }).then(res => res.json())
    } catch (error) {
        logger.info('[企业微信] 发送接口调用失败: ' + error)
        return
    }

    if (res.errcode == 0) {
        logger.info("[企业微信] 发送成功")
    } else {
        logger.info("[企业微信] 发送失败: " + res.errmsg)
    }
}

const wechatReg = /^#发送企业微信(.*)$/

export class wechatWorkApp extends plugin {
    constructor() {
        super({
            name: '微信推送',
            dsc: '微信推送',
            event: 'message',
            priority: 100,
            rule: [
                {
                    reg: wechatReg,
                    fnc: 'send',
                    permission: 'master'
                },
            ]
        })

        this.task = {
            cron: pushTime,
            name: 'Bot离线定时推送',
            fnc: () => this.autoTask()
        }
    }

    async send(e) {
        let regRet = wechatReg.exec(e.msg)
        let msg = regRet && regRet[1] || ""
        logger.info('[发送企业微信]: ' + msg)
        await wechatworkapp(msg)
    }

    async autoTask() {
        if (enableTask && online === false) {
            await wechatworkapp('Bot已离线')
        }
    }
}