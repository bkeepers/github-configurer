const yaml = require('js-yaml')
const mergeArrayByName = require('./lib/mergeArrayByName')

module.exports = (robot, _, Settings = require('./lib/settings')) => {
  async function syncSettings (context, repo = context.repo()) {
    const config = await context.config('settings.yml', {}, { arrayMerge: mergeArrayByName })
    return Settings.sync(context.github, repo, config)
  }

  robot.on('installation', async context => {
    const { github, payload } = context
    const { action, repositories, installation } = payload
    const { account } = installation
    const { login: repositoryOwner } = account

    if (action === 'deleted') {
      robot.log.debug('Integration deleted, returning...')
      return
    }

    await Promise.all(repositories.map(async (repository) => {
      const { name: repositoryName } = repository

      const repo = {
        owner: repositoryOwner,
        repo: repositoryName
      }

      var res
      try {
        res = await github.repos.getContents(Object.assign(repo, { path: Settings.FILE_NAME }))
      } catch (error) {
        if (error.status !== 404) {
          robot.log.warn(`Unknown error ${error.status} occurred when fetching '${Settings.FILE_NAME}' in '${repositoryOwner}/${repositoryName}', returning...`)
        } else {
          robot.log.debug(`File '${Settings.FILE_NAME}' not found in '${repositoryOwner}/${repositoryName}', returning...`)
        }
        return
      }

      const config = yaml.safeLoad(Buffer.from(res.data.content, 'base64').toString()) || {}
      return Settings.sync(context.github, repo, config)
    }))
  })

  robot.on('push', async context => {
    const { payload } = context
    const { repository } = payload

    const defaultBranch = payload.ref === 'refs/heads/' + repository.default_branch
    if (!defaultBranch) {
      robot.log.debug('Not working on the default branch, returning...')
      return
    }

    const settingsModified = payload.commits.find(commit => {
      return commit.added.includes(Settings.FILE_NAME) ||
        commit.modified.includes(Settings.FILE_NAME)
    })

    if (!settingsModified) {
      robot.log.debug(`No changes in '${Settings.FILE_NAME}' detected, returning...`)
      return
    }

    return syncSettings(context)
  })

  robot.on('repository.edited', async context => {
    const { payload } = context
    const { changes, repository } = payload

    if (!Object.prototype.hasOwnProperty.call(changes, 'default_branch')) {
      robot.log.debug('Repository configuration was edited but the default branch was not affected, returning...')
      return
    }

    robot.log.debug(`Default branch changed from '${changes.default_branch.from}' to '${repository.default_branch}'`)

    return syncSettings(context)
  })
}
