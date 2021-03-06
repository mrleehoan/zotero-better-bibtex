declare const Components: any
declare const Zotero: any
declare const ZOTERO_CONFIG: any
declare const Services: any

import { debug } from './debug.ts'

Components.utils.import('resource://zotero/config.js')
Components.utils.import('resource://gre/modules/Services.jsm')

// export singleton: https://k94n.com/es6-modules-single-instance-pattern
export let ZoteroConfig = { ...ZOTERO_CONFIG } // tslint:disable-line:variable-name
ZoteroConfig.isZotero = ZoteroConfig.GUID === 'zotero@chnm.gmu.edu'
ZoteroConfig.isJurisM = ZoteroConfig.GUID === 'juris-m@juris-m.github.io'
ZoteroConfig.Zotero = {
  version: Zotero.version,
  platform: Zotero.platform,
  oscpu: Zotero.oscpu,
  locale: Zotero.locale,
  appName: Services.appinfo.name,
  appVersion: Services.appinfo.version,
}

debug('zotero config loaded:', ZoteroConfig)
