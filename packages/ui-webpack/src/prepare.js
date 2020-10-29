import path from 'path';
import settings, {
  SETTING_HIDE_NODE_MODULES,
  SETTING_HIDE_NODE_MODULES_DEFAULT,
  SETTING_LIST_ITEMS_LIMIT,
  SETTING_LIST_ITEMS_LIMIT_DEFAULT,
} from './settings';

function generateColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  const h = hash % 360;
  return colorFromH(h);
}

function colorFromH(h) {
  return getHSLValue(h, 50, 85);
}

function getHSLValue(h, s, l) {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

const fileTypeMap = {
  '.wasm': 'wasm',
  '.json': 'json',
  '.html': 'html',

  '.js': 'script',
  '.jsx': 'script',
  '.es6': 'script',
  '.ts': 'script',
  '.tsx': 'script',
  '.flow': 'script',
  '.coffee': 'script',
  '.mjs': 'script',

  '.css': 'style',
  '.styl': 'style',
  '.scss': 'style',
  '.sass': 'style',
  '.less': 'style',

  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.svg': 'image',

  '.eot': 'font',
  '.ttf': 'font',
  '.woff': 'font',
  '.woff2': 'font',
};

function pluralFactory(pluralFn) {
  return {
    plural: pluralFn,
    pluralWithValue(value, words) {
      return `${value} ${pluralFn(value, words)}`;
    },
  };
}

const pluralRus = pluralFactory((value, [one, two, five = two]) => {
  let n = Math.abs(value);

  n %= 100;

  if (n >= 5 && n <= 20) {
    return five;
  }

  n %= 10;

  if (n === 1) {
    return one;
  }

  if (n >= 2 && n <= 4) {
    return two;
  }

  return five;
});

const pluralEng = pluralFactory((value, [one, many]) => {
  const n = Math.abs(value);

  return n === 0 || n > 1 ? many : one;
});

function createColorsFromString(strings) {
  const step = Math.round(360 / (strings.length || strings.size || 0));
  let currentStep = 0;
  const all = {};
  for (const value of strings) {
    all[value] = { color: colorFromH(currentStep) };
    currentStep += step;
  }

  return all;
}

const colorMap = {
  ...createColorsFromString(new Set(Object.values(fileTypeMap))),
};

function makeEntityResolver(entities, getId) {
  const cache = new Map();

  return (id) => {
    const cached = cache.get(id);

    if (cached) {
      return cached;
    }

    let result = null;

    if (Array.isArray(entities)) {
      for (const entity of entities) {
        if (getId(entity) === id) {
          result = entity;
          break;
        }
      }
    } else {
      for (const name in entities) {
        const entity = entities[name];

        if (getId(entity === id)) {
          result = entity;
          break;
        }
      }
    }

    if (result) {
      cache.set(id, result);
    }

    return result;
  };
}

const extractFileRx = /.*?\.[/\\](?:.+!\.[/\\])?(.+)/;
const contextIdRx = /(.+) (?:sync|eager|weak|async-weak|lazy|lazy-once) /;
const concatenatedIdRx = /(.+) \+ \d+ modules$/;

function matchRxValue(rx, string) {
  const [, match] = string.match(rx) || [];
  return match;
}

function moduleNameResource(name) {
  if (name && !name.includes('(ignored)') && !name.startsWith('multi')) {
    const normalized = matchRxValue(
      extractFileRx,
      name.replace('(webpack)', './node_modules/webpack')
    );
    return (
      matchRxValue(concatenatedIdRx, normalized) ||
      matchRxValue(contextIdRx, normalized) ||
      normalized
    );
  }
}

function moduleResource(module) {
  return moduleNameResource(module && module.name);
}

function moduleReasonResource(reason) {
  return moduleNameResource(reason && reason.moduleName);
}

// eslint-disable-next-line no-unused-vars
function parsePackages(path) {
  const allNodeModulesRx = /(?:^|[/\\])node_modules[/\\](@.+?[/\\][^/\\\s]+|[^/\\\s]+)/g;
  const packages = [];
  let cursor;

  while ((cursor = allNodeModulesRx.exec(path))) {
    const [matchedPath, packageName] = cursor;
    const { index } = cursor;
    const packagePath = path.slice(0, index + matchedPath.length);

    let thePackage = packages.find(({ name }) => name === packageName);

    if (!thePackage) {
      thePackage = { name: packageName, instances: [] };
      packages.push(thePackage);
    }

    if (!thePackage.instances.includes(packagePath)) {
      thePackage.instances.push(packagePath);
    }
  }

  return packages;
}

function nodeModule(path) {
  if (!path) {
    return null;
  }

  const lastNodeModulesRx = /.*(?:^|[/\\])node_modules[/\\](@.+?[/\\][^/\\\s]+|[^/\\\s]+)/;
  const [input, name] = path.match(lastNodeModulesRx) || [];
  return name ? { path: input, name } : null;
}

export default (rawData, { addQueryHelpers }) => {
  if (!rawData.entrypoints) {
    return;
  }

  rawData.nodeModules = [];

  const resolveModule = makeEntityResolver(
    rawData.modules.concat(...rawData.modules.map((m) => m.modules).filter(Boolean)),
    ({ identifier }) => identifier
  );
  const resolveChunk = makeEntityResolver(rawData.chunks, ({ id }) => id);
  const resolveAsset = makeEntityResolver(rawData.assets, ({ name }) => name);
  const resolvePackage = makeEntityResolver(rawData.nodeModules, ({ name }) => name);

  addQueryHelpers({
    encodeURIComponent: encodeURIComponent,
    decodeURIComponent: decodeURIComponent,
    stringify: JSON.stringify,
    toNumber(str) {
      return parseInt(str, 10);
    },
    formatSize(value) {
      if (isFinite(value)) {
        if (value < 1000 * 1000) {
          return (value / 1024).toFixed(2) + ' kb';
        }

        return (value / 1024 / 1024).toFixed(2) + ' mb';
      }
      return 'n/a';
    },
    color: (value) => (colorMap[value] ? colorMap[value].color : generateColor(value)),
    fileExt: (value = '') => {
      return path.extname(value);
    },
    fileType: (value = '') => {
      const extname = path.extname(value);
      return fileTypeMap[extname] || extname;
    },
    moduleSize(module) {
      // todo gzip
      return module.size;
    },
    chunkName(chunk) {
      return `${chunk.names[0] || chunk.id}${
        chunk.reason ? ' [' + chunk.reason + ']' : ''
      }`;
    },
    getTotalFilesSize: (value) =>
      (value.files || []).reduce((sum, file) => sum + file.size, 0),
    toMatchRegexp: (value) => new RegExp(`(${value})`),
    resolveChunk,
    resolveAsset,
    resolveModule,
    resolvePackage,
    moduleResource,
    moduleReasonResource,
    moduleNameResource,
    nodeModule,
    colorFromH,
    plural(value, words) {
      return pluralEng.plural(value, words);
    },
    pluralWithValue(value, words) {
      return pluralEng.pluralWithValue(value, words);
    },
    pluralRus(value, words) {
      return pluralRus.plural(value, words);
    },
    pluralWithValueRus(value, words) {
      return pluralRus.pluralWithValue(value, words);
    },
    modulesToFoamTree(modules) {
      function makeNode(name, size, path) {
        return {
          label: name,
          weight: size,
          groups: [],
          path,
        };
      }

      function handleModule(module) {
        const resource = moduleResource(module);

        if (!resource) {
          return;
        }

        const parts = resource.split(/[/\\]/);

        apply(parts, module.modules ? 0 : module.size);
      }

      function apply(parts, size) {
        const stack = [root];
        let cursor = root;

        function applyToStack(stack, size) {
          for (const item of stack) {
            item.weight += size;
          }
        }

        for (const part of parts) {
          let node = cursor.groups.find((node) => node.label === part);

          if (!node) {
            node = makeNode(
              part,
              0,
              [...stack, { label: part }]
                .map((item) => item.label)
                .filter(Boolean)
                .join('/')
            );
            cursor.groups.push(node);
          }

          cursor = node;
          stack.push(cursor);
        }

        applyToStack(stack, size);
      }

      const root = makeNode('', 0, '/');

      for (const module of modules) {
        handleModule(module);

        if (module.modules) {
          for (const innerModule of module.modules) {
            handleModule(innerModule);
          }
        }
      }

      return root;
    },
    setting(name, defaultValue) {
      return settings.get(name, defaultValue).get();
    },
    shouldHideModule(module) {
      const shouldHide = settings
        .get(SETTING_HIDE_NODE_MODULES, SETTING_HIDE_NODE_MODULES_DEFAULT)
        .get();
      const resource = moduleResource(module);

      if (!shouldHide || !resource) {
        return false;
      }

      return !!resource.match(/node_modules/);
    },
    settingListItemsLimit() {
      return settings
        .get(SETTING_LIST_ITEMS_LIMIT, SETTING_LIST_ITEMS_LIMIT_DEFAULT)
        .get();
    },
  });

  for (const chunk of rawData.chunks) {
    const extractModulePackages = (module) => {
      const resolvedModule = resolveModule(module.identifier);
      const resource = moduleResource(resolvedModule);

      if (!resource) {
        return;
      }

      const modulePackage = nodeModule(resource);

      if (modulePackage) {
        let resolvedPackage = resolvePackage(modulePackage.name);

        if (!resolvedPackage) {
          resolvedPackage = { name: modulePackage.name, instances: [] };
          rawData.nodeModules.push(resolvedPackage);
        }

        let instance = resolvedPackage.instances.find(
          ({ path }) => path === modulePackage.path
        );

        if (!instance) {
          instance = { path: modulePackage.path, reasons: [], modules: [resolvedModule] };
          resolvedPackage.instances.push(instance);
        } else {
          if (!instance.modules.includes(resolvedModule)) {
            instance.modules.push(resolvedModule);
          }
        }

        for (const reason of module.reasons) {
          const reasonPackage = nodeModule(moduleReasonResource(reason));

          if (reasonPackage && reasonPackage.path === instance.path) {
            continue;
          }

          if (
            !instance.reasons.find(
              (r) =>
                r.type === 'module' &&
                r.data.moduleIdentifier === reason.moduleIdentifier &&
                r.data.loc === reason.loc
            )
          ) {
            instance.reasons.push({ type: 'module', data: reason });
          }
        }
      }
    };

    for (const module of chunk.modules) {
      extractModulePackages(module);

      if (module.modules) {
        for (const innerModule of module.modules) {
          extractModulePackages(innerModule);
        }
      }
    }
  }

  return rawData;
};