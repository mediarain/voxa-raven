'use strict';

const Promise = require('bluebird');
const debug = require('debug')('voxa:raven');
const _ = require('lodash');

function register(skill, ravenClient) {
  const execute = skill.execute;
  const client = Promise.promisifyAll(ravenClient);

  skill.execute = client.wrap(execute);

  skill.onRequestStarted((request) => {
    const fromState = request.session.new ? 'entry' : request.session.attributes.state || 'entry';
    client.mergeContext({
      extra: { request: _.cloneDeep(request) },
    });

    if (process.env.LAMBDA_TASK_ROOT) {
      client.mergeContext({
        tags: {
          Lambda: process.env.AWS_LAMBDA_FUNCTION_NAME,
          Version: process.env.AWS_LAMBDA_FUNCTION_VERSION,
          LogStream: process.env.AWS_LAMBDA_LOG_STREAM_NAME,
        },
      });
    }

    client.captureBreadcrumb({
      message: 'Start state',
      category: 'stateFlow',
      data: {
        currentState: fromState,
      },
    });

    request.raven = client;
  });

  skill.onSessionEnded((request) => {
    if (request.request.reason === 'ERROR') {
      return client.captureExceptionAsync(new Error(request.request.error.message))
      .then((eventId) => {
        debug('Captured exception and sent to Sentry successfully with eventId: %s', eventId);
      });
    }
  });

  skill.onAfterStateChanged((request, reply, transition) => {
    debug('captureBreadcrumb', transition.to);
    client.captureBreadcrumb({
      message: 'State changed',
      category: 'stateFlow',
      data: {
        currentState: transition.to,
      },
    });
  });

  skill.onStateMachineError((request, reply, error) => client.captureExceptionAsync(error)
  .then((eventId) => {
    debug('Captured exception and sent to Sentry successfully with eventId: %s', eventId);
    request.ravenErrorReported = true;
  }));

  skill.onError((request, error) => {
    if (request.ravenErrorReported) {
      return null;
    }

    return ravenClient.captureExceptionAsync(error)
    .then((eventId) => {
      debug('Captured exception and sent to Sentry successfully with eventId: %s', eventId);
    });
  });
}

module.exports = register;

