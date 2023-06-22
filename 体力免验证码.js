import fetch from 'node-fetch'
import md5 from 'md5'
import moment from "moment"
import lodash from 'lodash'
import fs from "fs"
import YAML from 'yaml'
import puppeteer from '../../lib/puppeteer/puppeteer.js'
import Note from '../xiaoyao-cvs-plugin/model/note.js'
import { render } from '../xiaoyao-cvs-plugin/adapter/render.js'

/*
* 体力免验证码
* 从米游社小组件api获取体力详情，需要安装cvs插件并绑定stoken，支持原神和星穹铁道
*/

/*
* 与实时便笺api区别
* 原神：无派遣探索剩余时间、洞天宝钱回复时间、周本和质变仪信息；增加了每日签到状态
* 星穹铁道：包含实时便笺全部数据；额外增加了每日实训活跃度、模拟宇宙每周积分、每日签到状态
* 
* 小组件api已知问题
* 星穹铁道每日实训活跃度凌晨0点之后返回0，模拟宇宙每周积分周日返回0
*/

// 原神使用逍遥体力模板 (派遣探索时间、周本、质变仪信息均为虚假信息)
const xiaoyaoNote = false

const mysSalt = "fdv0fY9My9eA7MR0NpjGP9RjueFvjUSQ" //k2
const mysSalt2 = "t0qEgfub6cvueAPgR5m9aQWWVciEer7v" //x6
const DEVICE_ID = randomString(32).toUpperCase()
const DEVICE_NAME = randomString(lodash.random(1, 10))

export class dailyNoteByWidget extends plugin {
    constructor(e) {
        super({
            name: '体力免验证码',
            dsc: '原神|星铁体力免验证码',
            event: 'message',
            priority: -100,
            rule: [
                {
                    reg: '^#*(原神|星铁)?(体力|树脂|查询体力)$',
                    fnc: 'note',
                }
            ]
        })

        this._path = process.cwd().replace(/\\/g, '/')
        this.gsUrl = 'https://api-takumi-record.mihoyo.com/game_record/genshin/aapi/widget/v2'
        this.srUrl = 'https://api-takumi-record.mihoyo.com/game_record/app/hkrpg/aapi/widget'
    }

    async note(e) {
        let uid
        if (typeof e.user.getUid === 'function') { //Miao-Yunzai
            uid = e.user.getUid()
        } else { //其他版本Yunzai，可能需要手动切换uid
            uid = e.user.uid
        }
        if (!uid) {
            e.reply(`未绑定${e.isSr ? '星穹铁道' : '原神'}uid`)
            return false
        }
        let sk = this.getStoken(e.user_id, uid)
        if (lodash.isEmpty(sk)) {
            e.reply(`未找到${e.isSr ? '星穹铁道' : '原神'}uid:${uid}绑定的stoken，请先【#扫码登陆】绑定stoken或【#uid+序号】切换uid`)
            return false
        }
        this.uid = uid
        this.cookie = `stuid=${sk.stuid};stoken=${sk.stoken};mid=${sk.mid};`
        let headers = this.getHeaders(e.isSr)
        let res = await fetch(e.isSr ? this.srUrl : this.gsUrl, { method: "get", headers }).then(res => res.json())
        if (!res || res.retcode !== 0) return false

        if (!e.isSr && xiaoyaoNote) {
            let notes = new Note(e)
            res = this.dealData(res)
            return await notes.getNote({}, this.uid, res, { render })
        }

        let data = await this.getData(res)
        if (!data) return false

        let img = await puppeteer.screenshot(`dailyNoteByWidget${e.isSr ? '_SR' : ''}`, data)
        if (img) await this.reply(img)
    }

    async getData(res) {
        let data = this.e.isSr ? this.noteSr(res) : this.noteData(res)
        let screenData = {
            tplFile: `./resources/html/dailyNoteByWidget${this.e.isSr ? '_SR' : ''}/dailyNoteByWidget.html`,
            pluResPath: `${this._path}/resources/`,
        }
        let gameData
        if (this.e.isSr) {
            gameData = await this.getGameDate()
        }
        return {
            name: this.e.sender.card,
            quality: 100,
            ...screenData,
            ...data,
            ...gameData
        }
    }

    noteData(res) {
        let { data } = res

        let nowDay = moment().date()
        let nowUnix = Number(moment().format("X"))

        /** 树脂 */
        let resinMaxTime
        if (data.resin_recovery_time > 0) {
            resinMaxTime = nowUnix + Number(data.resin_recovery_time)

            let maxDate = moment.unix(resinMaxTime)
            resinMaxTime = maxDate.format("HH:mm")

            if (maxDate.date() != nowDay) {
                resinMaxTime = `明天 ${resinMaxTime}`
            } else {
                resinMaxTime = ` ${resinMaxTime}`
            }
        }

        /** 洞天宝钱无回复时间，按30/h进行估算 */
        let coinTime = ''
        if (!data.home_coin_recovery_time && data.current_home_coin < data.max_home_coin) {
            data.home_coin_recovery_time = (data.max_home_coin - data.current_home_coin) / 30 * 3600
        }
        if (data.home_coin_recovery_time > 0) {
            let coinDay = Math.floor(data.home_coin_recovery_time / 3600 / 24)
            let coinHour = Math.floor((data.home_coin_recovery_time / 3600) % 24)
            let coinMin = Math.floor((data.home_coin_recovery_time / 60) % 60)
            if (coinDay > 0) {
                coinTime = `${coinDay}天${coinHour}小时${coinMin}分钟`
            } else {
                let coinDate = moment.unix(
                    nowUnix + Number(data.home_coin_recovery_time)
                )

                if (coinDate.date() != nowDay) {
                    coinTime = `明天 ${coinDate.format('HH:mm')}`
                } else {
                    coinTime = coinDate.format('HH:mm')
                }
            }
        }

        let week = [
            "星期日",
            "星期一",
            "星期二",
            "星期三",
            "星期四",
            "星期五",
            "星期六",
        ]
        let day = `${moment().format("MM-DD HH:mm")} ${week[moment().day()]}`

        return {
            uid: this.uid,
            saveId: this.uid,
            resinMaxTime,
            coinTime,
            day,
            ...data,
        }
    }

    noteSr(res) {
        let { data } = res
        let nowDay = moment().date()

        /** 树脂 */
        let resinMaxTime
        if (data.stamina_recover_time > 0) {
            let d = moment.duration(data.stamina_recover_time, 'seconds')
            let day = Math.floor(d.asDays())
            let hours = d.hours()
            let minutes = d.minutes()
            let seconds = d.seconds()
            resinMaxTime = hours + '小时' + minutes + '分钟' + seconds + '秒'
            //精确到秒。。。。
            if (day > 0) {
                resinMaxTime = day + '天' + hours + '小时' + minutes + '分钟' + seconds + '秒'
            } else if (hours > 0) {
                resinMaxTime = hours + '小时' + minutes + '分钟' + seconds + '秒'
            } else if (minutes > 0) {
                resinMaxTime = minutes + '分钟' + seconds + '秒'
            } else if (seconds > 0) {
                resinMaxTime = seconds + '秒'
            }
            if ((day > 0) || (hours > 0) || (seconds > 0)) {
                let total_seconds = 3600 * hours + 60 * minutes + seconds
                const now = new Date()
                const dateTimes = now.getTime() + total_seconds * 1000
                const date = new Date(dateTimes)
                const dayDiff = date.getDate() - now.getDate()
                const str = dayDiff === 0 ? '' : '明天'
                const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date
                    .getMinutes()
                    .toString()
                    .padStart(2, '0')}`
                let recoverTimeStr = ` | ${str}${timeStr}`
                resinMaxTime += recoverTimeStr
            }
        }
        data.bfStamina = data.current_stamina / data.max_stamina * 100 + '%'

        /** 派遣 */
        for (let item of data.expeditions) {
            let d = moment.duration(item.remaining_time, 'seconds')
            let day = Math.floor(d.asDays())
            let hours = d.hours()
            let minutes = d.minutes()
            item.dateTime = ([day + '天', hours + '时', minutes + '分'].filter(v => !['0天', '0时', '0分'].includes(v))).join('')
            item.bfTime = (72000 - item.remaining_time) / 72000 * 100 + '%'
            if (item.avatars.length == 1) {
                item.avatars.push('派遣头像')
            }
        }

        // 标识属性图标~
        let icon = lodash.sample(['希儿', '白露', '艾丝妲', '布洛妮娅', '姬子', '卡芙卡', '克拉拉', '停云', '佩拉', '黑塔', '希露瓦', '银狼'])
        let week = [
            '星期日',
            '星期一',
            '星期二',
            '星期三',
            '星期四',
            '星期五',
            '星期六'
        ]

        let day = `${week[moment().day()]}`

        return {
            uid: this.uid,
            saveId: this.uid, icon, day,
            resinMaxTime, nowDay: moment(new Date()).format('YYYY年MM月DD日'),
            ...data
        }
    }

    // 赋值兼容图鉴模板
    dealData(res) {
        if (res.data.expeditions && res.data.expeditions.length >= 1) {
            for (let i in res.data.expeditions) {
                res.data.expeditions[i].remained_time = 3600 * 20
            }
        }
        res.data.home_coin_recovery_time = (res.data.max_home_coin - res.data.current_home_coin) / 30 * 3600
        res.data.remain_resin_discount_num = 3
        res.data.resin_discount_num_limit = 3
        res.data.transformer = { obtained: false }

        return res
    }

    async getGameDate() {
        let headers = this.getHeaders()
        let res = await fetch('https://api-takumi.miyoushe.com/binding/api/getUserGameRolesByStoken', { method: "get", headers }).then(res => res.json())
        if (res && res.retcode === 0) {
            let list = res?.data?.list || {}
            for (let i in list) {
                if (list[i].game_uid == this.uid) {
                    return list[i]
                }
            }
        }
        return {}
    }

    getStoken(userId, uid) {
        let file = `${this._path}/plugins/xiaoyao-cvs-plugin/data/yaml/${userId}.yaml`
        if (fs.existsSync(file)) {
            let ck = fs.readFileSync(file, 'utf-8')
            ck = YAML.parse(ck)
            if (ck[uid]) {
                return ck[uid]
            }
        }
        return {}
    }

    getDs(salt = mysSalt) {
        const randomStr = randomString(6)
        const timestamp = Math.floor(Date.now() / 1000)
        let sign = md5(`salt=${salt}&t=${timestamp}&r=${randomStr}`)
        return `${timestamp},${randomStr},${sign}`
    }

    getDs2(q = "", b = "", salt = mysSalt2) {
        let t = Math.round(new Date().getTime() / 1000)
        let r = Math.floor(Math.random() * 900000 + 100000)
        let DS = md5(`salt=${salt}&t=${t}&r=${r}&b=${b}&q=${q}`)
        return `${t},${r},${DS}`
    }

    getHeaders(isSr = false) {
        return {
            'Cookie': this.cookie,
            "x-rpc-channel": "miyousheluodi",
            'x-rpc-device_id': DEVICE_ID,
            'x-rpc-app_version': '2.40.1',
            "x-rpc-device_model": "Mi 10",
            'x-rpc-device_name': DEVICE_NAME,
            'x-rpc-client_type': '2',
            "DS": isSr ? this.getDs2() : this.getDs(),
            "Referer": "https://app.mihoyo.com",
            "x-rpc-sys_version": "12",
            //"Host": "api-takumi-record.mihoyo.com",
            "User-Agent": "okhttp/4.8.0",
        }
    }
}

function randomString(length, os = false) {
    let randomStr = ''
    for (let i = 0; i < length; i++) {
        randomStr += lodash.sample(os ? '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' :
            'abcdefghijklmnopqrstuvwxyz0123456789')
    }
    return randomStr
}