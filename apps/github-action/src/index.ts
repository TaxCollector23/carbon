import * as core from '@actions/core';
import * as github from '@actions/github';
import { carbon } from '@carbon/sdk';

/**
 * Entry point for the Carbon GitHub Action.
 *
 * Boots a replica from the given spec, publishes its URL as an output, and
 * (when running inside a pull_request event with a GITHUB_TOKEN) posts a
 * comment on the PR so reviewers can click through.
 */
async function run(): Promise<void> {
  const specPath = core.getInput('spec-path', { required: true });
  const upstreamUrl = core.getInput('upstream-url');
  const apiKey = core.getInput('api-key');
  if (apiKey) core.setSecret(apiKey);

  const replica = await carbon.emulate({ from: specPath, port: 0 });
  core.setOutput('replica-url', replica.url);
  core.info(`Carbon replica ready at ${replica.url}`);
  if (upstreamUrl) core.info(`Upstream configured: ${upstreamUrl}`);

  const token = process.env.GITHUB_TOKEN;
  const ctx = github.context;
  const prNumber = ctx.payload.pull_request?.number;
  if (token && prNumber && ctx.repo.owner && ctx.repo.repo) {
    const octokit = github.getOctokit(token);
    await octokit.rest.issues.createComment({
      owner: ctx.repo.owner,
      repo: ctx.repo.repo,
      issue_number: prNumber,
      body: `Try the replica: ${replica.url}`,
    });
    core.info(`Commented on PR #${prNumber}`);
  } else {
    core.info('Skipping PR comment (no GITHUB_TOKEN or not a pull_request event).');
  }

  // Keep the process alive so the ephemeral server can serve traffic during
  // subsequent workflow steps.
}

run().catch((err: Error) => {
  core.setFailed(err.message);
});
