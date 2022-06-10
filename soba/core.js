function SobaInstance(requestedClassId) {

    // metadata manager

    function MetadataManager() {
        const metadataManager = this;
        const storage = {};

        metadataManager.classId = function (name, version) {
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

        function ClassMetadata(attributes) {
            this.classId = metadataManager.classId(attributes.name, attributes.version);
            this.name = attributes.name;
            this.version = attributes.version;
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

        metadataManager.define = function (classProperties) {
            metadataManager.register(new ClassMetadata(classProperties));
        }

        metadataManager.getClassMetadata = function (classId) {
            if (!storage[classId]) throw new Error("Class " + classId + " is not defined");
            return storage[classId];
        }

        metadataManager.getInheritanceChain = function (classMetaOrId) {
            let found = [];
            function findInheritedMetadata(currentClassMeta) {
                if (found.indexOf(currentClassMeta) !== -1) return;
                if (currentClassMeta.inherits) {
                    for (const className in currentClassMeta.inherits) {
                        let classVersion = currentClassMeta.inherits[className]
                        findInheritedMetadata(metadataManager.getClassMetadata(metadataManager.classId(className, classVersion)));
                    }
                }
                found.push(currentClassMeta);
            }
            let classMeta = (classMetaOrId instanceof ClassMetadata) ? classMetaOrId : metadataManager.getClassMetadata(classMetaOrId);
            findInheritedMetadata(classMeta);
            return found;
        }
    }

    // basic class implementation
    function SobaObject(classMeta, initValues = {}) {
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
                let res = ext.perInheritance.apply(self, [representedClass, shared]);
                if (res) addToShared(res);
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

    // basic classes
    // inheritance

    const inheritableStaticDataStorage = new function () {
        const self = this;
        const singletons = {};
        const classStaticData = {};

        self.registerSingleton = function (singleton) {
            if (singletons[singleton.metadata.classId]) throw new Error("An attempt to register second singleton of class " + singleton.metadata.classId);
            singletons[singleton.metadata.classId] = singleton;
        }
        self.getSingleton = function (classId) {
            return singletons[classId];
        }
        self.getStaticData = function (classId) {
            return (self.staticDataExists(classId)) ? classStaticData[classId] : null;
        }
        self.staticDataExists = function (classId) {
            return (classStaticData[classId] !== undefined)
        }
        self.setStaticData = function (classId, data) {
            classStaticData[classId] = data;
        }
        Object.freeze(self);
    }()

    metadataManager.define({
        name: "interface",
        version: 1,
        extensions: {
            static: {
                store: function (value) {
                    if ((typeof value !== "function") && (value !== null) && (value !== undefined)) throw new Error("Class static space must be a function or null/undefined");
                    return value;
                },
                perInheritance: function (classMeta, shared) {
                    if ((typeof classMeta.static === "function") && (!inheritableStaticDataStorage.staticDataExists(classMeta.name))) {
                        let static = classMeta.static.apply(shared.self, shared);
                        inheritableStaticDataStorage.setStaticData(classMeta.classId, static);
                    }
                }
            },
            private: {
                store: function (value) {
                    if ((typeof value !== "function") && (value !== null) && (value !== undefined)) throw new Error("Class constructor must be a function or null/undefined");
                    return value;
                },
                perInheritance: function (classMeta, shared) {
                    if (!classMeta.private) return;
                    let classStaticSpace = inheritableStaticDataStorage.getStaticData(classMeta.classId);
                    return { [classMeta.name]: classMeta.private.apply(shared.self, [shared, classStaticSpace]) };
                },
            },
            public: {
                store: function (value) {
                    if ((typeof value !== "function") && (value !== null) && (value !== undefined)) throw new Error("Class constructor must be a function or null/undefined");
                    return value;
                },
                perInheritance: function (classMeta, shared) {
                    if (!classMeta.public) return;
                    let classStaticSpace = inheritableStaticDataStorage.getStaticData(classMeta.classId);
                    let public = classMeta.public.apply(shared.self, [shared, classStaticSpace]);
                    for (let key in public) {
                        let property = public[key];
                        if (shared.interface.isProperty(property)) property.alias(shared.self, key);
                        else Object.defineProperty(shared.self, key, {
                            value: property,
                            configurable: false,
                            writable: false,
                        });
                    }
                }
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
                store: function (value) {
                    if ((typeof value !== "function") && (value !== null) && (value !== undefined)) throw new Error("Completed trigger must be a function or null/undefined");
                    return value;
                },
                completed: function ({ self }) {
                    self.metadata.completed();
                },
            },
        },
        static: function () {
            function Property({ value, get, set, trigger, validator, readonly }) {
                const self = this;
                if (value === undefined) value = null;
                if (get === undefined) get = function () {
                    return value;
                }
                if (set === undefined) set = function (newValue) {
                    return newValue;
                }
                if ((trigger !== undefined) && (typeof trigger !== "function")) throw new Error("Property change trigger must be a function");
                if ((validator !== undefined) && (typeof validator !== "function")) throw new Error("Property validator must be a function");
                this.get = function () {
                    return get(value);
                }
                this.set = function (newValue) {
                    if (newValue === value) return;
                    if (readonly) throw new Error("An attempt to write readonly property");
                    if ((validator) && (!validator(newValue))) return;
                    set(newValue);
                    if (trigger) trigger();
                }
                this.alias = function (object, name) {
                    Object.defineProperty(object, name, {
                        get: self.get,
                        set: self.set,
                        configurable: false,
                    })
                }
                Object.freeze(this);
            }

            return { Property }
        },
        private: function ({ }, static) {
            function property(arg) {
                return new static.Property(arg);
            }
            function isProperty(val) {
                return (val instanceof static.Property)
            }
            function createEnum() {
                return new Enum(arguments)
            }
            return { property, isProperty, enum: createEnum }
        },
    });

    // util

    metadataManager.define({
        name: "util",
        version: 1,
        inherits: { "interface": 1 },
        static: function () {
            function Path(read, write) {
                if ((typeof read === "string") && (write === undefined)) write = read;
                if ((typeof read !== "string") && (typeof read !== "function")) throw new Error("Path.read must be a string or a function");
                this.read = read;
                this.readonly = (write === undefined);
                this.write = (this.readonly) ? null : write;
                Object.freeze(this);
            }
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
            return { Path, Enum, EnumVariant }
        },
        private: function ({ self }, static) {
            const paths = Object.freeze({
                read: function (rootObject, path) {
                    if (path instanceof static.Path) path = path.read;
                    if (typeof path === "string") {
                        if (path.startsWith("@value:")) return path.substring(7);
                        if (path == "@root") return rootObject;
                        return path.split(".").reduce(function (ref, element) { return ref[element] }, rootObject);
                    }
                    if (typeof path === "function") {
                        return path.apply(rootObject, Array.from(arguments));
                    }
                    throw new Error("Wrong path specification");
                },
                write: function (rootObject, path, value, create) {
                    if (path instanceof static.Path) path = path.write;
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
                },
            });

            const enums = Object.freeze({
                createEnum: function () {
                    return new static.Enum(Array.from(arguments));
                },
                isEnumVariant: function (value) {
                    return value instanceof static.EnumVariant;
                },
                isVariantOf: function (value, enumType) {
                    return ((enums.isEnumVariant(value)) && (value.parent == enumType));
                }
            })

            return { paths, enums }
        },
    })


    // events
    metadataManager.define({
        name: "event",
        version: 1,
        inherits: { "interface": 1 },
        public: function ({ self, interface }) {
            const subsribers = [];

            const muted = interface.property({
                value: false,
                set: function (value) {
                    return !!value;
                }
            });

            const subscribers = interface.property({
                value: [],
                get: function (value) {
                    return value.slice();
                },
                set: function (func, oldValue) {
                    oldValue.push(func);
                }
            });

            function on(func) {
                if (subsribers.indexOf(func) != -1) return;
                subsribers.push(func);
            }
            function off(func) {
                let index = subsribers.indexOf(func);
                if (index === -1) return;
                subsribers.splice(index, 1)
            }
            function emit(sender, arg) {
                for (let subscriber of subsribers) subscriber.apply(sender, [sender, arg]);
            }
            function mute() {
                self.muted = true;
            }
            function unmute() {
                self.unmuted = false;
            }
            function runMuted(func) {
                self.muted = true;
                func();
                self.muted = false;
            }
            function once(func) {
                self.on(function onceHandler() {
                    func();
                    self.off(onceHandler);
                })
            }
            return { muted, subscribers, on, off, emit, mute, unmute, runMuted, once, trigger: emit };
        }
    })

    metadataManager.define({
        name: "events",
        inherits: { "interface": 1 },
        version: 1,
        extensions: {
            events: {
                store: function (value) {
                    if (!Array.isArray(value)) throw new Error("Events list must be an array");
                    return value;
                }
            },
        },
        private: function ({ self }) {
            const events = {};
            function registerClassEvents(classMeta) {
                if (!classMeta.events) return;
                const classEvents = {};
                for (eventName of classMeta.events) classEvents[eventName] = new SobaObject(metadataManager.getClassMetadata("event:1"));
                Object.freeze(classEvents);
                events[classMeta.name] = classEvents;
            }
            for (classMeta of self.metadata.representedClasses) registerClassEvents(classMeta);
            Object.freeze(events);
            return events;
        },
        public: function ({ self, events }) {
            return { events };
        }
    })

    metadataManager.define({
        name: "log",
        version: 1,
        inherits: { "events": 1 },
        events: ["debug", "error"],
        static: function ({ util }) {

            const logTypes = util.enums.createEnum("info", "warning", "critical", "fatal");

            function LogMessage({ type, message, dump, error }) {
                if (!util.enums.isVariantOf(type, static.logTypes)) throw new LogMessage({
                    type: logTypes.critical,
                    message: "Wrong log type specified in log message",
                    dump: { type, message, dump }
                });
            }

            return { logTypes, LogMessage }
        },
        private: function ({ self, events, util }, static) {

            function info(message, dump, result) {
                const logMessage = new static.LogMessage({
                    type: logTypes.info,
                    message: message,
                    dump: dump,
                });
                events.health.debug.emit(self, { logMessage, result });
                return result;
            }

            function warning(message, dump, result) {
                const logMessage = new static.LogMessage({
                    type: logTypes.warning,
                    message: message,
                    dump: dump,
                });
                events.health.debug.emit(self, { logMessage, result });
                return result;
            }

            function critical(err, dump) {
                const logMessage = new static.LogMessage({
                    type: logTypes.critical,
                    message: err.message,
                    dump: dump,
                    error: err
                });
                events.health.error.emit(self, { logMessage });
                return err;
            }

            function fatal(err, dump) {
                const logMessage = new static.LogMessage({
                    type: logTypes.fatal,
                    message: message,
                    dump: dump,
                    error: err
                });
                events.health.error.emit(self, { logMessage });
                return err;
            }

            function safeExec(func, res, dump) {
                try {
                    return func();
                }
                catch (err) {
                    critical(err, dump);
                    return (res === undefined) ? null : res;
                }
            }

            return { logTypes: statuc.logTypes, info, warning, critical, fatal, try: safeExec }
        }
    })

    metadataManager.define({
        name: "types",
        version: 1,
        inherits: {
            "events": 1,
            "util": 1,
            "interface": 1
        },
        extensions: {
            types: {
                store: function (value) {
                    if (!Array.isArray(value)) throw new Error("Types must be an array");
                    return value;
                },
            }
        },
        static: function ({ log }) {
            function defaultValidator(value) {
                if (value == null) return true;
                return value instanceof this.create;
            }

            function TypeMetadata({ create, name, isPrimitive, validate, convert }) {
                if (typeof create != "function") throw log.critical("Type must have a constructor", arguments);
                this.create = create;
                this.name = (name) ? name : create.name;
                if (!this.name) throw log.critical("Type must have a name", arguments);
                this.isPrimitive = !!isPrimitive;
                if ((validate !== undefined) && (typeof validate !== null) && (typeof validate !== "function")) throw log.critical("Type validator must be a function", arguments);
                this.validate = ((validate !== undefined) && (typeof validate !== null)) ? validate : defaultValidator;
                Object.freeze(this);
            }

            const basicTypes = {};

            function createTypeMetadata(typeDescription) {
                if (typeof typeDescription==="function") return new static.TypeMetadata({create: typeDescription});
                return new static.TypeMetadata(typeDescription)
            }

            function registerBasicType(typeDescription) {
                const type = createTypeMetadata(typeDescription);
                if (basicTypes[type.name] !== undefined) throw log.critical("This type is already registered", arguments);
                basicTypes[type.name] = type;
            }

            function registerBasicTypes(types) {
                for (typeDescription of types) registerBasicType(typeDescription)
            }

            const utilStatic = inheritableStaticDataStorage.getStaticData("util:1");    //TODO: find a better solution probably?
            const logStatic = inheritableStaticDataStorage.getStaticData("log:1");
            registerBasicTypes([utilStatic.Path, utilStatic.Enum, utilStatic.EnumVariant, logStatic.LogMessage]);
            registerBasicTypes([
                {
                    create: Number,
                    isPrimitive: true,
                    validate: function (value) {
                        return (typeof value === "number");
                    },
                },
                {
                    create: Number,
                    name: "Integer",
                    isPrimitive: true,
                    validate: function (value) {
                        return !isNaN(parseInt(value))
                    },
                },
                {
                    create: String,
                    isPrimitive: true,
                    validate: function (value) {
                        return (typeof value === "string");
                    },
                },
                {
                    create: Boolean,
                    isPrimitive: true,
                    validate: function (value) {
                        return (typeof value === "boolean");
                    },
                },
                Error,
                Object,
                Date,
                Function,
                Array,
                {
                    create: function Any() {
                        throw new Error("Any is a virtual type that can't be created")
                    },
                    validate: function() {
                        return true
                    }
                },
                {
                    create: function EmptyValue() {
                        throw new Error("EmptyValue is a virtual type that can't be created")
                    },
                    validate: function(value) {
                        return ((value===undefined)||(value===null)||(value===""))
                    }
                }
            ])

            return { TypeMetadata, basicTypes, createTypeMetadata }
        },
        private: function ({ self, log }, static) {
            
            const localTypes = {}
            
            const types = interface.property({
                get: function (value) {
                    return Object.assign({}, static.basicTypes, localTypes)
                },
                readonly: true
            });

            function registerType(typeDescription) {
                const type = static.createTypeMetadata(typeDescription);
                if (localTypes[type.name] !== undefined) throw log.critical("This type is already registered", arguments);
                localTypes[type.name] = type;
            }

            function getType(name) {
                if (static.basicTypes[name] !== undefined) return static.basicTypes[name];
                if (localTypes[name] !== undefined) return localTypes[name];
                throw log.critical("There's no type registered with the name provided", arguments);
            }

            function registerTypes(types) {
                for (typeDescription of types) registerType(typeDescription)
            }

            for (classMeta of self.metadata.representedClasses) if (classMeta.types!==undefined) registerTypes(classMeta.types);

            Object.freeze(localTypes);

            return {types, getType}
        }
    })

    metadataManager.define({
        name: "basic",
        version: 1,
        inherits: {
            "events": 1,
            "util": 1,
            "interface": 1,
        },
        events: ["completed", "free"],
        private: function ({ self, events, interface, health, types }) {

            const parent = interface.property({
                value: null,
                validator: function (newValue) {
                    types.mustBe(newValue, "@basic:1|null");
                }
            })

            events.basic.completed.emit();
        },
        free: function () {
            self.events.basic.free.emit();
        }
    })

    metadataManager.define({
        name: "objectmanager",
        version: 1,
        inherits: { "basic": 1 },
        singleton: true,
        private: function (shared) {
            console.log("Objectmanager constructor", shared);
        },
    });

    return new SobaObject(metadataManager.getClassMetadata(requestedClassId));

}

console.log(new SobaInstance("objectmanager:1"));