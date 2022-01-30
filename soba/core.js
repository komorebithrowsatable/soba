function SobaInstance() {

    // enums
    const enumManager = new function EnumManager() {
        let enumber = 1;
        this.next = function () {
            return enumber++;
        }
    }()

    function Enum() {
        for (let i = 0; i < arguments.length; i++) {
            if (typeof arguments[i] !== "string") throw new Error("Enum value must be a string");
            this[arguments[i]] = enumManager.next();
        }
        Object.freeze(this);
    }

    // metadata manager
    const basicExtensionTypes = new Enum("preInit", "sharedModifier", "perInheritance", "completeTrigger");

    function MetadataManager() {
        const metadataManager = this;
        const storage = {};

        metadataManager.createClassId = function (name, version) {
            if (!name) throw new Error("Please provide class name");
            if (!version) throw new Error("Please provide class version");
            return String(name) + ":" + String(version);
        }

        function ClassExtension(name, meta) {
            if (!name) throw new Error("Extension needs a name");
            this.name = name;
            if (typeof meta.implementation !== "function") throw new Error("Attribute extension must be a function");
            if ((meta.store !== undefined) && (typeof meta.store !== "function")) throw new Error("Extension.store must be a function");
            if (typeof meta.type !== "number") throw new Error("Extension.type must be enum/integer");
            this.store = meta.store;
            this.implementation = meta.implementation;
            this.type = meta.type;
            Object.freeze(this)
        }

        function ClassMetadata(name, version, attributes) {
            this.classId = metadataManager.createClassId(name, version);
            this.name = name;
            this.version = version;
            if (!attributes) throw new Error("Please provide class attributes");
            if ((attributes.extends) && (!(attributes.extends instanceof Object))) throw new Error("ClassMetadata.extends attribute must be an object");
            if (attributes.extends) {
                this.extends = Object.assign({}, attributes.extends);
                Object.freeze(this.extends);
            }
            if (attributes.inherits) {
                this.inherits = Object.assign({}, attributes.inherits);
                Object.freeze(this.inherits);
            }

            const representedClasses = metadataManager.getInheritanceChain(this);
            Object.freeze(representedClasses);
            this.representedClasses = representedClasses;
            const ownExtensions = [];
            const extensions = [];
            const extensionUniqueNames = [];

            if (attributes.extensions) for (const extName in attributes.extensions) {
                ownExtensions.push(new ClassExtension(extName, attributes.extensions[extName]));
            }
            Object.freeze(ownExtensions);
            this.ownExtensions = ownExtensions;
            for (const classMeta of representedClasses) {
                for (ext of classMeta.ownExtensions) {
                    if (extensions.indexOf(ext) != -1) continue;
                    if (extensionUniqueNames.indexOf(ext.name) != -1) throw new Error("Extension conflict: extension with name " + ext.name + " already used");
                    extensions.push(ext);
                    extensionUniqueNames.push(ext.name);
                }
            };
            Object.freeze(extensions);
            extensions.filter(function (ext) { return !!ext.store }).forEach(function (ext) {
                if (attributes[ext.name] !== undefined) this[ext.name] = ext.store(attributes[ext.name]);
            }, this);
            this.extensions = extensions;
            Object.freeze(this);
        }

        metadataManager.register = function (classMeta) {
            if (!(classMeta instanceof ClassMetadata)) throw new Error("Class metadata you've provided is not an instance of ClassMetadata");
            if (storage[classMeta.classId]) throw new Error("Class metadata with this class id is already defined");
            storage[classMeta.classId] = classMeta;
        }

        metadataManager.define = function (className, version, attributes) {
            metadataManager.register(new ClassMetadata(className, version, attributes));
        }

        metadataManager.getClassMetadataByClassId = function (classId) {
            if (!storage[classId]) throw new Error("Class " + classId + " is not defined");
            return storage[classId];
        }

        metadataManager.getClassMetadata = function () {
            if (arguments[0] instanceof ClassMetadata) return arguments[0];
            if (typeof arguments[0] === "string") {
                if (arguments[1] !== undefined) return metadataManager.getClassMetadataByClassId(metadataManager.createClassId(arguments[0], arguments[1]));
                else return metadataManager.getClassMetadataByClassId(arguments[0]);
            }
            throw new Error("Unable to indentify class by provided arguments: " + JSON.stringify(arguments));
        }

        metadataManager.getInheritanceChain = function () {
            let found = [];
            function findInheritedMetadata(currentClassMeta) {
                if (found.indexOf(currentClassMeta) !== -1) return;
                if (currentClassMeta.inherits) {
                    for (const className in currentClassMeta.inherits) {
                        let classVersion = currentClassMeta.inherits[className]
                        findInheritedMetadata(metadataManager.getClassMetadata(className, classVersion));
                    }
                }
                found.push(currentClassMeta);
            }
            let classMeta = metadataManager.getClassMetadata.apply(null, Array.from(arguments));
            findInheritedMetadata(classMeta);
            return found;
        }
    }

    // basic class implementation
    function Basic(classMeta, initValues = {}) {
        const self = this;
        Object.defineProperty(self, "metadata", { value: classMeta, configurable: false, writable: false, enumerable: true });

        // shared
        const shared = {};

        function addToShared(keyValue) {
            for (let key in keyValue) {
                if (shared[key]) throw new Error("Shared space already contains key " + key);
                Object.defineProperty(shared, key, { value: keyValue[key], configurable: false, writable: false, enumerable: true });
            }
        }

        addToShared({ classMeta, self, initValues });

        // sort extensions by type
        const extByType = {};
        for (const type in basicExtensionTypes) {
            extByType[basicExtensionTypes[type]] = [];
        }
        for (const extension of classMeta.extensions) {
            extByType[extension.type].push(extension);
        }

        // preinits
        for (const ext of extByType[basicExtensionTypes.preInit]) {
            let res = ext.implementation.apply(self, [shared]);
            if (res !== undefined) return res;    // an ability to interrupt init and return another object or value, useful for singletons and similar cases
        }

        //shared modifiers
        for (const ext of extByType[basicExtensionTypes.sharedModifier]) {
            let res = ext.implementation.apply(self, [shared]);
            if (res) addToShared(res);
        };

        // metadata attrubutes
        for (const representedClass of classMeta.representedClasses) {
            for (const ext of extByType[basicExtensionTypes.perInheritance]) {
                ext.implementation.apply(self, [representedClass, shared]);
            };
        }

        // complete triggers
        for (let i = extByType[basicExtensionTypes.completeTrigger].length - 1; i >= 0; i--) {
            let ext = extByType[basicExtensionTypes.completeTrigger][i];
            ext.implementation.apply(self, [shared]);
        };
    }

    const metadataManager = new MetadataManager();

    //basic classes
    const inheritableStaticDataStorage = new function () {
        const self = this;
        const singletons = {};
        const staticSpaces = {};

        self.registerSingleton = function (singleton) {
            if (singletons[singleton.metadata.classId]) throw new Error("An attempt to register second singleton of class " + singleton.metadata.classId);
            singletons[singleton.metadata.classId] = singleton;
        }
        self.getSingleton = function (classId) {
            return singletons[classId];
        }
        self.getStaticSpace = function(object) {
            if (!staticSpaces[object.metadata.classId]) staticSpaces[object.metadata.classId] = {};
            return staticSpaces[object.metadata.classId];
        }
        Object.freeze(self);
    }()

    metadataManager.define("inheritable", 1, {
        extensions: {
            protected: {
                implementation: function () {
                    return { protected: {} }
                },
                type: basicExtensionTypes.sharedModifier
            },
            static: {
                implementation: function ({self}) {
                    return { static: inheritableStaticDataStorage.getStaticSpace(self) }
                },
                type: basicExtensionTypes.sharedModifier
            },
            create: {
                store: function (value) {
                    if ((typeof value !== "function") && (value !== null) && (value !== undefined)) throw new Error("Class constructor must be a function or null/undefined");
                    return value;
                },
                implementation: function (classMeta, shared) {
                    shared.protected[classMeta.name] = {};
                    classMeta.create.apply(shared.self, [shared]);
                    Object.freeze(shared.protected[classMeta.name]);
                },
                type: basicExtensionTypes.perInheritance
            },
            abstract: {
                store: function (value) {
                    return !!value;
                },
                implementation: function ({ self }) {
                    if (self.metadata.abstract) throw new Error("Abstract classes can only be inherited");
                },
                type: basicExtensionTypes.preInit
            },
            singleton: {
                store: function (value) {
                    return !!value;
                },
                implementation: function ({ self }) {
                    if (self.metadata.singleton) {
                        let instance = inheritableStaticDataStorage.getSingleton(self.metadata.classId);
                        if (instance) return instance;
                        else inheritableStaticDataStorage.registerSingleton(self);
                    }
                },
                type: basicExtensionTypes.preInit
            }
        },
        create: function (shared) {
            console.log("INheritable constructor");
        },
    });

    metadataManager.define("objectmanager", 1, {
        inherits: { "inheritable": 1 },
        singleton: true,
        create: function (shared) {
            console.log("Objectmanager constructor");
        },
    });

    return new Basic(metadataManager.getClassMetadata("objectmanager", 1));

}

console.log(new SobaInstance());