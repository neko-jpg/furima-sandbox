const RUNTIME_ENV_KEYS = [
  'FURIMA_D1_API_TOKEN',
  'FURIMA_D1_API_ACTOR_ID',
  'FURIMA_D1_CONTROL_TOKEN',
  'FURIMA_LOCAL_FIXTURE_MODE',
  'FURIMA_LOCAL_FIXTURE_REQUIRE_AUTH',
  'FURIMA_STORAGE_MODE',
  'FURIMA_DEPLOYMENT_ENV',
];

export const configureSandboxRuntimeForTest = ({ fixtureMode = 'true', storageMode = 'memory' } = {}) => {
  const previous = new Map(RUNTIME_ENV_KEYS.map((key) => [key, process.env[key]]));
  delete process.env.FURIMA_D1_API_TOKEN;
  delete process.env.FURIMA_D1_API_ACTOR_ID;
  delete process.env.FURIMA_D1_CONTROL_TOKEN;
  process.env.FURIMA_LOCAL_FIXTURE_MODE = fixtureMode;
  process.env.FURIMA_STORAGE_MODE = storageMode;

  return () => {
    for (const key of RUNTIME_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
};
