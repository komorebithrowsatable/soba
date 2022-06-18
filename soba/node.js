const fs = require("fs");
const vm = require("vm");
const process = require("process");
const path = require("path");

const context = vm.createContext({console: console}, {
    name: "Soba core context",
});

const coreFilePath = path.join(process.cwd(), "core.js");
vm.runInContext(fs.readFileSync(coreFilePath), context, coreFilePath, 0);
const mainSobaInstance = context.SobaInstance("core:1");

mainSobaInstance.define({
    name: "platform.nodejs",
    version: 1,
    inherits: {"platform.abstract": 1},
    public: function({types}) {
        return {
            nativeModule: types.function(["String!"], (moduleName)=> {
                return require(moduleName);
            }),
            createTimer: setTimeout,
            destroyTimer: clearTimeout,
            load
        }
    }
})