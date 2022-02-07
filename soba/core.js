function SobaInstance() {

    // enums
    function EnumVariant(parent, name) {
        this.parent = parent;
        this.name = name;
        Object.freeze(this);
    }

    function Enum() {
        for (let i = 0; i < arguments.length; i++) {
            if (typeof arguments[i] !== "string") throw new Error("Enum value must be a string");
            this[arguments[i]] = new EnumVariant(this, arguments[i]);
        }
        Object.freeze(this);
    }

    // metadata manager

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
            if ((meta.store !== undefined) && (typeof meta.store !== "function")) throw new Error("Extension.store must be a function");
            if ((meta.preInitialize !== undefined) && (typeof meta.preInitialize !== "function")) throw new Error("Extension.preInitialize must be a function");
            if ((meta.sharedModifiers !== undefined) && (typeof meta.sharedModifiers !== "function")) throw new Error("Extension.sharedModifiers must be a function");
            if ((meta.perInheritance !== undefined) && (typeof meta.perInheritance !== "function")) throw new Error("Extension.perInheritance must be a function");
            if ((meta.complete !== undefined) && (typeof meta.complete !== "function")) throw new Error("Extension.complete must be a function");
            this.store = meta.store;
            this.preInitialize = meta.preInitialize;
            this.sharedModifiers = meta.sharedModifiers;
            this.perInheritance = meta.perInheritance;
            this.completed = meta.completed;
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

        // preinits
        for (const ext of classMeta.extensions) {
            if (!ext.preInitialize) continue;
            let res = ext.preInitialize.apply(self, [shared]);
            if (res !== undefined) return res;    // an ability to interrupt init and return another object or value, useful for singletons and similar cases
        }

        //shared modifiers
        for (const ext of classMeta.extensions) {
            if (!ext.sharedModifiers) continue;
            let res = ext.sharedModifiers.apply(self, [shared]);
            if (res) addToShared(res);
        };

        // metadata attributes
        for (const representedClass of classMeta.representedClasses) {
            for (const ext of representedClass.extensions) {
                if (!ext.perInheritance) continue;
                ext.perInheritance.apply(self, [representedClass, shared]);
            };
        }

        // complete triggers
        for (let i = classMeta.extensions.length - 1; i >= 0; i--) {
            let ext = classMeta.extensions[i];
            if (!ext.complete) continue;
            ext.complete.apply(self, [shared]);
        };
    }

    const metadataManager = new MetadataManager();

    //basic classes
    // inheritance

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
        self.getStaticSpace = function (object) {
            if (!staticSpaces[object.metadata.classId]) staticSpaces[object.metadata.classId] = {};
            return staticSpaces[object.metadata.classId];
        }
        Object.freeze(self);
    }()

    metadataManager.define("inheritable", 1, {
        extensions: {
            protected: {
                sharedModifiers: function () {
                    return { protected: {} }
                },
            },
            static: {
                SharedArrayBuffer: function ({ self }) {
                    return { static: inheritableStaticDataStorage.getStaticSpace(self) }
                },
            },
            create: {
                store: function (value) {
                    if ((typeof value !== "function") && (value !== null) && (value !== undefined)) throw new Error("Class constructor must be a function or null/undefined");
                    return value;
                },
                perInheritance: function (classMeta, shared) {
                    shared.protected[classMeta.name] = {};
                    classMeta.create.apply(shared.self, [shared]);
                    Object.freeze(shared.protected[classMeta.name]);
                },
            },
            abstract: {
                store: function (value) {
                    return !!value;
                },
                preInitialize: function ({ self }) {
                    if (self.metadata.abstract) throw new Error("Abstract classes can only be inherited");
                },
            },
            singleton: {
                store: function (value) {
                    return !!value;
                },
                preInitialize: function ({ self }) {
                    if (self.metadata.singleton) {
                        let instance = inheritableStaticDataStorage.getSingleton(self.metadata.classId);
                        if (instance) return instance;
                        else inheritableStaticDataStorage.registerSingleton(self);
                    }
                },
            },
            completed: {
                completed: function({self}) {
                    Object.freeze(self);
                },
            }
        },
        create: function (shared) {
            console.log("INheritable constructor");
        },
    });

    // paths
    function Path(read, write) {
        if ((typeof read === "string") && (write === undefined)) write = read;
        if ((typeof read !== "string") && (typeof read !== "function")) throw new Error("Path.read must be a string or a function");
        this.read = read;
        this.readonly = (write === undefined);
        this.write = (this.readonly) ? null : write;
        Object.freeze(this);
    }

    metadataManager.define("paths", 1, {
        inherits: { "inheritable": 1 },
        create: function ({ self, protected }) {
            protected.paths.read = function (rootObject, path) {
                if (path instanceof Path) path = path.read;
                if (typeof path === "string") {
                    if (path.startsWith("@value:")) return path.substring(7);
                    if (path == "@root") return rootObject;
                    return path.split(".").reduce(function (ref, element) { return ref[element] }, rootObject);
                }
                if (typeof path === "function") {
                    return path.apply(rootObject, Array.from(arguments));
                }
                throw new Error("Wrong path specification");
            }
            protected.paths.write = function (rootObject, path, value, create) {
                if (path instanceof Path) path = path.write;
                if (typeof path === "string") {
                    let parts = path.split(".");
                    let reference = rootObject;
                    for (let i = 0; i < keys.length - 1; i++) {
                        let key = parts[i];
                        if ((create) && (reference[key] === undefined)) reference[key] = {};
                        reference = reference[key];
                    }
                    let lastKey = parts[parts.length - 1];
                    reference[lastKey] = value;
                }
                if (typeof path === "function") {
                    path.apply(null, Array.from(arguments));
                }
                throw new Error("Wrong path specification");
            }
        }
    })

    // events
    metadataManager.define("event", 1, {
        inherits: { "inheritable": 1 },
        create: function ({ self }) {
            const subsribers = [];
            self.on = function (func) {
                if (subsribers.indexOf(func) != -1) return;
                subsribers.push(func);
            }
            self.off = function (func) {
                let index = subsribers.indexOf(func);
                if (index === -1) return;
                subsribers.splice(index, 1)
            }
            self.emit = function (sender, arg) {
                for (let subscriber of subsribers) subscriber.apply(sender, [sender, arg]);
            }
            Object.defineProperty("subscribers", {
                get: function () {
                    return subsribers.slice();
                },
                set: function (func) {
                    self.subscribe(func);
                }
            })
        }
    })

    metadataManager.define("events", 1, {
        extensions: {
            events: {
                store: function (value) {
                    if (!Array.isArray(value)) throw new Error("Events list must be an array");
                    return value;
                },
                perInheritance: function (classMeta, shared) {
                    if (!self.events) self.events = {};
                    self.events[classMeta.name] = {};
                    for (let eventName in classMeta.events) {
                        let eventObject = new Basic(metadataManager.getClassMetadata("event", 1));
                        self.events[classMeta.name][eventName] = eventObject;
                    }
                    Object.freeze(self.events[classMeta.name])
                },
                complete: function({self}) {
                    Object.freeze(self.events);
                }
            },
        }
    })

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