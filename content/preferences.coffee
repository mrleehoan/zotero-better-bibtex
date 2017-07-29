debug = require('./debug.coffee')
events = require('./events.coffee')

class Preferences
  prefix: 'translators.better-bibtex'

  constructor: ->
    prefService = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService)
    @branch = prefService.getBranch("extensions.zotero.#{@prefix}.")
    @branch.addObserver('', @, false)

  key: (pref) -> "#{@prefix}.#{pref}"

  set: (pref, value) ->
    debug('Prefs.set', pref, value)
    Zotero.Prefs.set(@key(pref), value)
    return

  get: (pref) ->
    try
      return Zotero.Prefs.get(@key(pref))
    catch
      return null

  clear: (pref) ->
    try
      Zotero.Prefs.clear(@key(pref))
    catch err
      debug('Prefs.clear', pref, err)

    return

  observe: (branch, topic, pref) ->
    debug('preference', pref, 'changed to', @get(pref))
    events.emit('preference-changed', pref)
    return

  onChange: (observer) ->
    events.on('preference-changed', observer)
    return

module.exports = new Preferences()