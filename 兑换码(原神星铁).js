import common from '../../lib/common/common.js'
import fetch from 'node-fetch'

/**
 * 原神&星穹铁道前瞻直播兑换码推送
 * 默认在直播当天晚上9点以及次日早上11点推送两次
 */

const cfg = {
  /** 推送时间 */
  pushTime: '0 0 11,21 * * ?',
  /** 群号 */
  groupList: [123456, 456789]
}

export class exchange extends plugin {
  constructor() {
    super({
      name: '原神|星铁兑换码',
      dsc: '原神|星铁前瞻直播兑换码',
      event: 'message',
      priority: -100,
      rule: [
        {
          reg: '^#*(原神|星铁|崩铁)?(直播|前瞻)?兑换码$',
          fnc: 'code'
        },
        {
          reg: '^#兑换码推送$',
          permission: 'master',
          fnc: 'exchangeTask'
        }
      ]
    })

    this.Uids = {
      gs: [75276550],
      sr: [288909600, 80823548]
    }

    this.task = {
      cron: cfg.pushTime,
      name: '兑换码推送任务',
      fnc: () => this.exchangeTask(),
    }
  }

  async code() {
    const actId = await this.getActIdByGame(this.e.isSr ? 'sr' : 'gs')
    if (!actId) {
      logger.info('[兑换码] 未获取到actId')
      await this.reply(`暂无${this.e.isSr ? '星穹铁道' : '原神'}直播兑换码`)
      return false
    }

    const { codes, title, deadline } = await this.getCode(actId)
    if (!codes) {
      return await this.reply(`暂无${this.e.isSr ? '星穹铁道' : '原神'}直播兑换码`)
    }

    let msg = [`${title}-直播兑换码`, ...codes]
    if (deadline) {
      msg.splice(1, 0, `兑换码过期时间: \n${deadline.getFullYear()}年${deadline.getMonth() + 1}月${deadline.getDate()}日 12:00:00`)
    }
    msg = await common.makeForwardMsg(this.e, msg, msg[0])
    await this.reply(msg)
  }

  async getCode(actId) {
    this.actId = actId
    this.now = parseInt(Date.now() / 1000)

    let index = await this.getData('index')
    if (!index || !index.data) return {}

    let index_data = index.data.live
    let title = index_data['title']
    this.code_ver = index_data['code_ver']
    if (index_data.remain > 0) return {}

    //截止日期第二天中午12点
    let deadline = new Date(index_data['start'])
    deadline.setDate(deadline.getDate() + 1)
    deadline.setHours(12, 0, 0, 0)

    let code = await this.getData('code')
    if (!code || !code.data?.code_list) {
      logger.info('[兑换码] 未获取到兑换码')
      return {}
    }

    let codes = []
    for (let val of code.data.code_list) {
      if (val.code) {
        codes.push(val.code)
      }
    }

    return { codes, title, deadline }
  }

  async getData(type) {
    let url = {
      index: `https://api-takumi.mihoyo.com/event/miyolive/index`,
      code: `https://api-takumi-static.mihoyo.com/event/miyolive/refreshCode?version=${this.code_ver}&time=${this.now}`,
      actId: `https://bbs-api.mihoyo.com/painter/api/user_instant/list?offset=0&size=20&uid=${this.uid}`,
    }

    let response
    try {
      response = await fetch(url[type], {
        method: 'get',
        headers: {
          'x-rpc-act_id': this.actId
        }
      })
    } catch (error) {
      logger.error(error.toString())
      return false
    }

    if (!response.ok) {
      logger.error(`[兑换码接口错误][${type}] ${response.status} ${response.statusText}`)
      return false
    }
    const res = await response.json()
    return res
  }

  async getActId(uid) {
    let actId = ''
    this.uid = uid
    let ret = await this.getData('actId')
    if (ret.error || ret.retcode !== 0) {
      return actId
    }

    let keywords = ['前瞻']
    for (const p of ret?.data?.list) {
      const post = p?.post?.post
      if (!post) {
        continue
      }
      if (!keywords.every((word) => post.subject.includes(word))) {
        continue
      }
      let content = post.structured_content
      let matched = content.match(/{\"link\":\"https:\/\/webstatic.mihoyo.com\/bbs\/event\/live\/index.html\?act_id=(.*?)\\/)
      if (matched) {
        actId = matched[1]
        break
      }
    }

    return actId
  }

  async getActIdByGame(game = 'gs') {
    let actId
    for (const uid of this.Uids[game]) {
      actId = await this.getActId(uid)
      if (actId) continue
    }
    return actId
  }

  async exchangeTask() {
    logger.mark('[兑换码推送] 开始检测直播兑换码')
    if (cfg.groupList.length <= 0) {
      logger.mark('[兑换码推送] 未设置推送群号')
      return
    }
    for (const game of ['gs', 'sr']) {
      const actId = await this.getActIdByGame(game)
      if (actId) {
        const { codes, title, deadline } = await this.getCode(actId)
        if (!codes || codes.length === 0) continue
        const now = new Date()
        const diff = deadline.getTime() - now.getTime()
        const diffInHours = diff / (1000 * 60 * 60)
        if (diffInHours < 24 && diffInHours > 0) {
          logger.mark('[兑换码推送] 检测到直播兑换码，开始推送...')
          let msg = [`${title}-直播兑换码`, ...codes]
          let e = {
            isGroup: true,
            bot: Bot
          }
          for (let groupId of cfg.groupList) {
            if (!e.bot.gl.get(groupId)) {
              logger.mark(`[兑换码推送] 未加入群:${groupId}`)
              continue
            }
            e.group = e.bot.pickGroup(Number(groupId))
            e.group_id = Number(groupId)
            let tmp = await common.makeForwardMsg(e, msg, msg[0])
            if (!tmp) return
            await e.group.sendMsg(`本次前瞻直播兑换码将于${deadline.getMonth() + 1}月${deadline.getDate()}日12:00:00失效，记得尽快兑换哦~`)
            await common.sleep(2000)
            await e.group.sendMsg(tmp)
            await common.sleep(10000)
          }
        }
      }
      await common.sleep(10000)
    }
  }
}
