const core = require("@actions/core");
const compose = require("docker-compose");
const utils = require("./utils");

try {
  utils.printCwdFiles();
  const composeFiles = utils.parseComposeFiles(
    core.getMultilineInput("compose-file")
  );
  if (!composeFiles.length) {
    return;
  }

  const services = core.getMultilineInput("services", { required: false });

  const options = {
    config: composeFiles,
    log: true,
    composeOptions: utils.parseFlags(core.getInput("compose-flags")),
    commandOptions: utils.parseFlags(core.getInput("up-flags")),
  };

  const promise =
    services.length > 0
      ? compose.upMany(services, options)
      : compose.upAll(options);

  // wait for max 2 minutes for all services to be healthy using their healthchecks
  const timeout = 120000;
  const interval = 1000;
  const start = Date.now();
  const end = start + timeout;
  const healthcheck = async () => {
    console.log('checking health');
    const health = await compose.ps({
      config: composeFiles,
    });
    const healthy = health.out.every((service) => {
      return service.state === "healthy";
    });
    if (healthy) {
      console.log("all services healthy");
      return;
    }
    if (Date.now() < end) {
      setTimeout(healthcheck, interval);
    } else {
      console.log("timeout waiting for services to be healthy");
      process.exit(1);
    }
  };

  promise
    .then(async () => {
      console.log("compose started");

      // wait for all services to be healthy
      console.log('waiting for services to be healthy');
      await healthcheck();
      console.log('services are healthy');

      // Run tests command.
      const testContainer = core.getInput("test-container");
      const testCommand = core.getInput("test-command");

      console.log("testContainer", testContainer);
      console.log("testCommand", testCommand);

      if (testCommand && testContainer) {
        setTimeout(() => {
          const test = compose.exec(testContainer, testCommand, {
            config: composeFiles,
          });

          test
            .then((out) => {
              console.log(out.out);
              console.log("tests passed");
            })
            .catch((err) => {
              console.log(err.out);
              console.log(err.err);
              console.log(err);
              core.setFailed(`tests failed ${JSON.stringify(err)}`);
            });
        }, 100000);
      }
    })
    .catch((err) => {
      core.setFailed(`compose up failed ${JSON.stringify(err)}`);
    });
} catch (error) {
  core.setFailed(error.message);
}
