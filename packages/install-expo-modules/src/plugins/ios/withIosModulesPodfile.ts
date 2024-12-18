import { ConfigPlugin, IOSConfig, withDangerousMod } from '@expo/config-plugins';
import fs from 'fs';
import path from 'path';
import semver from 'semver';

const { getProjectName } = IOSConfig.XcodeUtils;

export const withIosModulesPodfile: ConfigPlugin = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = await fs.promises.readFile(podfile, 'utf8');
      const projectName = getProjectName(config.modRequest.projectRoot);
      contents = updatePodfile(contents, projectName, config.sdkVersion);

      await fs.promises.writeFile(podfile, contents);
      return config;
    },
  ]);
};

export function updatePodfile(
  contents: string,
  projectName: string,
  sdkVersion: string | undefined
): string {
  // require autolinking module
  if (!contents.match(/^require.+'expo\/package\.json.+scripts\/autolinking/m)) {
    contents = `require File.join(File.dirname(\`node --print "require.resolve('expo/package.json')"\`), "scripts/autolinking")\n${contents}`;
  }

  // use_expo_modules!
  if (!contents.match(/^\s*use_expo_modules!\s*$/m)) {
    const targetRegExp = new RegExp(`(^\\s*target\\s+['"]${projectName}['"]\\s+do\\s*$)`, 'm');
    contents = contents.replace(targetRegExp, '$1\n  use_expo_modules!');
  }

  // use_native_modules! from expo-modules-autolinking
  if (sdkVersion && semver.gte(sdkVersion, '52.0.0')) {
    const autolinkinRegExp = /^(\s+config\s+=\s+use_native_modules!\s*)$/m;
    const newBlock = `\

  if ENV['EXPO_USE_COMMUNITY_AUTOLINKING'] == '1'
    config_command = ['node', '-e', "process.argv=['', '', 'config'];require('@react-native-community/cli').run()"];
  else
    config_command = [
      'node',
      '--no-warnings',
      '--eval',
      'require(require.resolve(\\'expo-modules-autolinking\\', { paths: [require.resolve(\\'expo/package.json\\')] }))(process.argv.slice(1))',
      'react-native-config',
      '--json',
      '--platform',
      'ios'
    ]
  end

  config = use_native_modules!(config_command)
`;
    contents = contents.replace(autolinkinRegExp, newBlock);
  }

  // expo_patch_react_imports!
  if (sdkVersion && semver.gte(sdkVersion, '44.0.0') && semver.lt(sdkVersion, '52.0.0')) {
    if (!contents.match(/\bexpo_patch_react_imports!\(installer\)\b/)) {
      const regExpPostIntegrate = /(\bpost_integrate do \|installer\|)/;
      if (contents.match(regExpPostIntegrate)) {
        contents = contents.replace(
          regExpPostIntegrate,
          `$1
    begin
      expo_patch_react_imports!(installer)
    rescue => e
      Pod::UI.warn e
    end`
        );
      } else {
        // If there's no existing post_integrate hook,
        // use the `use_expo_modules!` as the insertion anchor.
        contents = contents.replace(
          /(\buse_expo_modules!\n)/gm,
          `$1\
  post_integrate do |installer|
    begin
      expo_patch_react_imports!(installer)
    rescue => e
      Pod::UI.warn e
    end
  end\n`
        );
      }
    }
  }

  return contents;
}
