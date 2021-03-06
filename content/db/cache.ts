declare const Zotero: any

import { createFile } from '../create-file.ts'
import { XULoki as Loki } from './loki.ts'
import { debug } from '../debug.ts'
import { Events } from '../events.ts'
import { ZoteroConfig } from '../zotero-config.ts'

const version = require('../../gen/version.js')
const translators = require('../../gen/translators.json')

import { Preferences as Prefs } from '../prefs.ts'

// tslint:disable-next-line:no-magic-numbers
const stringify = Prefs.get('testing') ? data => JSON.stringify(data, null, 2) : data => JSON.stringify(data)

class NoSuchFileError extends Error {
  public name = 'NoSuchFile'

  constructor(message) {
    super(message)
  }
}

class FileStore {
  public mode = 'reference'

  private collectionsMissing = false

  public name(name) { return name + '.json' }

  public save(name, data) {
    debug('FileStore.save', name)
    const db = createFile(name + '.saving')
    Zotero.File.putContents(db, stringify(data))
    db.moveTo(null, this.name(name))
    debug('FileStore.saved', name, 'to', this.name(name))
  }

  public load(name) {
    name = this.name(name)
    debug('FileStore.load', name)
    const db = createFile(name)
    if (!db.exists()) throw new NoSuchFileError(`${db.path} not found`)
    const data = JSON.parse(Zotero.File.getContents(db))

    // this is intentional. If all is well, the database will be retained in memory until it's saved at
    // shutdown. If all is not well, this will make sure the caches are rebuilt from scratch
    db.remove(true)

    return data
  }

  public exportDatabase(name, dbref, callback) {
    debug('FileStore.exportDatabase: saving', name)

    try {
      for (const coll of dbref.collections) {
        if (coll.dirty || this.collectionsMissing) this.save(`${name}.${coll.name}`, coll)
      }
      // save header last for sort-of-transaction
      this.save(name, {...dbref, ...{collections: dbref.collections.map(coll => coll.name)}})
      this.collectionsMissing = false
    } catch (err) {
      debug('LokiJS.FileStore.exportDatabase: save failed', err)
    }

    debug('LokiJS.FileStore.exportDatabase: save completed', name)
    return callback(null)
  }

  public loadDatabase(name, callback) {
    debug('FileStore.loadDatabase: loading', name)

    let db
    try {
      db = this.load(name)
    } catch (err) {
      if (err.name === 'NoSuchFile') {
        debug('LokiJS.FileStore.loadDatabase: new database')
      } else {
        Zotero.logError(err)
      }
      return callback(null)
    }

    try {
      const collections = []
      for (const coll of db.collections) {
        try {
          const data = this.load(`${name}.${coll}`)
          data.cloneObjects = true // https://github.com/techfort/LokiJS/issues/47#issuecomment-362425639
          Zotero.debug(`Loaded ${name}.${coll}: ${JSON.stringify(data.transforms)}`)
          collections.push(data)
        } catch (err) {
          this.collectionsMissing = true
          debug('LokiJS.FileStore.loadDatabase: collection load failed, proceeding', err)
        }
      }
      db.collections = collections
    } catch (err) {
      debug('LokiJS.FileStore.loadDatabase: load failed', err)
    }

    return callback(db)
  }
}

// export singleton: https://k94n.com/es6-modules-single-instance-pattern
export let DB = new Loki('cache', { // tslint:disable-line:variable-name
  autosave: true,
  adapter: new FileStore(),
})

const METADATA = 'Better BibTeX metadata'

DB.remove = function(ids) {
  const query = Array.isArray(ids) ? { itemID : { $in : ids } } : { itemID: ids }

  for (const coll of this.collections) {
    coll.findAndRemove(query)
  }
}

function clearOnUpgrade(coll, property, current) {
  const dbVersion = (coll.getTransform(METADATA) || [{value: {}}])[0].value[property]
  if (current && dbVersion === current) {
    Zotero.debug(`CACHE: retaining cache ${coll.name} because stored ${property} is ${dbVersion} (current: ${current})`)
    return
  }

  if (dbVersion) {
    Zotero.debug(`CACHE: dropping cache ${coll.name} because ${property} went from ${dbVersion} to ${current}`)
  } else {
    Zotero.debug(`CACHE: dropping cache ${coll.name} because ${property} was not set (current: ${current})`)
  }

  coll.removeDataOnly()

  coll.setTransform(METADATA, [{
    type: METADATA,
    value : { [property]: current },
  }])
}

DB.init = () => {
  DB.loadDatabase()
  let coll = DB.schemaCollection('itemToExportFormat', {
    indices: [ 'itemID', 'legacy', 'skipChildItems' ],
    cloneObjects: true,
    schema: {
      type: 'object',
      properties: {
        itemID: { type: 'integer' },
        legacy: { type: 'boolean', default: false },
        skipChildItems: { type: 'boolean', default: false },
        item: { type: 'object' },

        // LokiJS
        meta: { type: 'object' },
        $loki: { type: 'integer' },
      },
      required: [ 'itemID', 'legacy', 'skipChildItems', 'item' ],
      additionalProperties: false,
    },
  })

  clearOnUpgrade(coll, 'Zotero', ZoteroConfig.Zotero.version)

  // this reaps unused cache entries -- make sure that cacheFetchs updates the object
  //                  secs    mins  hours days
  const ttl =         1000  * 60  * 60  * 24 * 30 // tslint:disable-line:no-magic-numbers
  const ttlInterval = 1000  * 60  * 60  * 4       // tslint:disable-line:no-magic-numbers
  for (const translator of Object.keys(translators.byName)) {
    coll = DB.schemaCollection(translator, {
      indices: [ 'itemID', 'exportNotes', 'useJournalAbbreviation' ],
      schema: {
        type: 'object',
        properties: {
          itemID: { type: 'integer' },
          exportNotes: { type: 'boolean', default: false },
          useJournalAbbreviation: { type: 'boolean', default: false },
          reference: { type: 'string' },

          // Optional
          metadata: { type: 'object', default: {} },

          // LokiJS
          meta: { type: 'object' },
          $loki: { type: 'integer' },
        },
        required: [ 'itemID', 'exportNotes', 'useJournalAbbreviation', 'reference' ],
        additionalProperties: false,
      },
      ttl,
      ttlInterval,
    })

    clearOnUpgrade(coll, 'BetterBibTeX', version)
  }
}

// the preferences influence the output way too much, no keeping track of that
Events.on('preference-changed', async () => {
  await Zotero.BetterBibTeX.ready

  for (const translator of Object.keys(translators.byName)) {
    DB.getCollection(translator).removeDataOnly()
  }
})

// cleanup
if (DB.getCollection('cache')) { DB.removeCollection('cache') }
if (DB.getCollection('serialized')) { DB.removeCollection('serialized') }
