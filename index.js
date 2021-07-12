const mergeArrayByName = require('./lib/mergeArrayByName')

/**
 * @param {import('probot').Probot} robot
 */
module.exports = (robot, _, Settings = require('./lib/settings')) => {
  async function syncSettings (context, repo = context.repo()) {
    const config = await context.config('settings.yml', {}, { arrayMerge: mergeArrayByName })
    return Settings.sync(context.octokit, repo, config)
  }

  async function triggerRepositoryUpdate (_context, { owner, repo }) {
    /* Clone context without reference */
    const context = Object.assign(Object.create(Object.getPrototypeOf(_context)), _context)

    /* Change context to target repository */
    const { repository } = context.payload
    context.payload.repository = Object.assign(repository || {}, {
      owner: {
        login: owner
      },
      name: repo
    })

    return syncSettings(context, { owner, repo })
  }

  robot.on([
    'installation.created',
    'installation.new_permissions_accepted'
  ], async context => {
    const { payload } = context
    const { repositories, installation } = payload
    const { account } = installation
    const { login: repositoryOwner } = account

    if (!repositories) {
      robot.log.debug('No new repositories found in the installation event, returning...')
      return
    }

    await Promise.all(repositories.map(async (repository) => {
      const { name: repositoryName } = repository

      return triggerRepositoryUpdate(context, {
        owner: repositoryOwner,
        repo: repositoryName
      })
    }))
  })

  robot.on('installation_repositories.added', async context => {
    const { payload } = context
    const { repositories_added: repositories, installation } = payload
    const { account } = installation
    const { login: repositoryOwner } = account

    if (!repositories) {
      robot.log.debug('No new repositories found in the installation event, returning...')
      return
    }

    await Promise.all(repositories.map(async (repository) => {
      const { name: repositoryName } = repository

      return triggerRepositoryUpdate(context, {
        owner: repositoryOwner,
        repo: repositoryName
      })
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

  robot.on('repository.created', async context => {
    return syncSettings(context)
  })
}
