// @ts-nocheck

import Debug from 'debug'
import config from '@packages/server/lib/config'
import plugins from '@packages/server/lib/plugins'
import devserver from '@packages/server/lib/plugins/devserver'
import { ProjectBase } from '@packages/server/lib/project-base'
import settings from '@packages/server/lib/util/settings'
import specsUtil from '@packages/server/lib/util/specs'
import { ServerCt } from './server-ct'
import { SpecsStore } from './specs-store'

export * from '@packages/server/lib/project-base'

const debug = Debug('cypress:server-ct:project')

export class ProjectCt extends ProjectBase {
  protected server: ServerCt

  get projectType () {
    return 'ct'
  }

  open (options = {}) {
    this.server = new ServerCt()

    return super.open(options, {
      onOpen: (cfg) => {
        return this._initPlugins(cfg, options)
        .then(({ cfg, specsStore }) => {
          cfg.proxyServer = null

          return this.server!.open(cfg, specsStore, this, options.onError, options.onWarning)
          .spread((port, warning) => {
            return {
              cfg,
              port,
              warning,
            }
          })
        })
      },
    })
  }

  _initPlugins (cfg, options) {
    // only init plugins with the
    // allowed config values to
    // prevent tampering with the
    // internals and breaking cypress
    const allowedCfg = config.allowed(cfg)

    return plugins.init(allowedCfg, {
      projectRoot: this.projectRoot,
      configFile: settings.pathToConfigFile(this.projectRoot, options),
    })
    .then((modifiedCfg) => {
      debug('plugin config yielded: %o', modifiedCfg)

      const updatedConfig = config.updateWithPluginValues(cfg, modifiedCfg)

      updatedConfig.componentTesting = true

      debug('updated config: %o', updatedConfig)

      return updatedConfig
    })
    .then((modifiedConfig) => {
      // now that plugins have been initialized, we want to execute
      // the plugin event for 'devserver:config' and get back
      // @ts-ignore - let's not attempt to TS all the things in packages/server

      return specsUtil.find(modifiedConfig)
      .filter((spec: Cypress.Cypress['spec']) => {
        return spec.specType === 'component'
      })
      .then((specs) => {
        return devserver.start({ specs, config: modifiedConfig })
        .then((port) => {
          modifiedConfig.webpackDevServerUrl = `http://localhost:${port}`

          const specsStore = new SpecsStore(cfg)

          specsStore.watch({
            onSpecsChanged: (specs) => {
              // send new files to dev server
              devserver.updateSpecs(specs)

              // send new files to frontend
              this.server.sendSpecList(specs)
            },
          })

          return specsStore.storeSpecFiles()
          .return({
            specsStore,
            cfg: modifiedConfig,
          })
        })
      })
    })
  }

  close () {
    return super.close()
  }
}
