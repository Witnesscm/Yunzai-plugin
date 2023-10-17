import MysApi from '../genshin/model/mys/mysApi.js'
if (!global.MysApiFix) global.MysApiFix = {}

/**
 * 临时解决 #探索、#深渊 等功能1034验证码问题
 * 目前米游社深渊等接口也添加了设备验证，如果请求头没有x-rpc-device_fp(设备指纹)几乎必返回1034，手动或自动过验证仅能维持一两个小时
 * 使用抓包获取的x-rpc-device_fp实测可以大概率避免1034，推荐自行抓包米游社app
 */

/** 抓包获取的x-rpc-device_fp参数 */
global.MysApiFix.device_fp = '38d7f0aac0ab7'

/** 启用hook */
global.MysApiFix.enable = true

if (!global.MysApiFix.isHooked) {
  const origMysApiGetData = MysApi.prototype.getData
  MysApi.prototype.getData = async function (...args) {
    if (global.MysApiFix.enable) {
      if (!args[1]) args[1] = {}
      args[1].headers = { ...args[1].headers, 'x-rpc-device_fp': global.MysApiFix.device_fp }
    }
    return await origMysApiGetData.call(this, ...args)
  }
  global.MysApiFix.isHooked = true
}
