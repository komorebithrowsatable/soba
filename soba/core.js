function SobaInstance() {

    function MetadataManager() {
        const metadataManager = this;
        const storage = {};

        metadataManager.createClassId = function (name, version) {
            if (!name) throw new Error("Please provide class name");
            if (!version) throw new Error("Please provide class version");
            return String(name) + ":" + String(version);
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
            const extendedAttributes = [];

            for (const classMeta of representedClasses) {
                if ((classMeta.extends) && (classMeta.extends.attributes instanceof Object)) for (const attrName in classMeta.extends.attributes) {
                    if (extendedAttributes.indexOf(attrName) !== -1) throw new Error("This attribute overflows another one with the same name");
                    if (typeof classMeta.extends.attributes[attrName] !== "function") throw new Error("Attribute extension must contain implemetation (function)");
                    extendedAttributes.push(attrName);
                }
            };
            for (const attrName of extendedAttributes) {
                if (attributes[attrName] !== undefined) this[attrName] = attributes[attrName];
            };
            Object.freeze(representedClasses);
            Object.freeze(extendedAttributes);
            this.representedClasses = representedClasses;
            this.extendedAttributes = extendedAttributes;
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

    function Basic(classMeta, initValues = {}) {
        const self = this;
        Object.defineProperty(self, "metadata", { value: classMeta, configurable: false, writable: false, enumerable: true });

        // shared modifiers
        const shared = {};

        function addToShared(keyValue) {
            for (let key in keyValue) {
                if (shared[key]) throw new Error("Shared space already contains key " + key);
                Object.defineProperty(shared, key, { value: keyValue[key], configurable: false, writable: false, enumerable: true });
            }
        }

        addToShared({ classMeta, self, initValues })

        for (const representedClass of classMeta.representedClasses) {
            if (!representedClass.extends) continue;
            if (typeof representedClass.extends.shared !== "function") throw new Error("Shared modifier implementation must be a function");
            addToShared(representedClass.extends.shared(shared));
        };

        // metadata attrubutes
        const attributeImplementations = {};

        console.log(classMeta.representedClasses)
        for (const representedClass of classMeta.representedClasses) {
            console.log(representedClass)
            if (!representedClass.extends) continue;
            if (!representedClass.extends.attributes) continue;
            Object.keys(representedClass.extends.attributes).forEach(function (attrName) {
                let implementation = representedClass.extends.attributes[attrName];
                if (typeof implementation !== "function") throw new Error("Attribute implementation must be a function");
                if (attributeImplementations[attrName]) throw new Error("This attribute overflows another one with the same name");
                attributeImplementations[attrName] = implementation;
            });
        }


        for (const representedClass of classMeta.representedClasses) {
            for (attrName of representedClass.extendedAttributes) {
                attributeImplementations[attrName].apply(self, [representedClass, shared]);
            };
        }

        // complete triggers
        for (let i = classMeta.representedClasses.length - 1; i >= 0; i--) {
            let representedClass = classMeta.representedClasses[i];
            if ((representedClass.extends) && (typeof representedClass.extends.complete === "function")) representedMeta.extends.complete.apply(self, [shared])
        }
    }

    const metadataManager = new MetadataManager();

    metadataManager.define("inheritable", 1, {
        extends: {
            shared: function ({ classMeta }) {
                let protected = {};
                return { protected };
            },
            attributes: {
                create: function (classMeta, shared) {
                    if (typeof classMeta.create != "function") throw new Error("Class constuctor must be a function");
                    shared.protected[classMeta.name] = {};
                    classMeta.create.apply(shared.self, [shared]);
                    Object.freeze(shared.protected[classMeta.name]);
                }
            }
        },
        create: function (shared) {
            console.log("INheritable constructor", shared);
        }
    });

    metadataManager.define("objectmanager", 1, {
        inherits: { "inheritable": 1 },
        create: function (shared) {
            console.log("Objectmanager constructor", shared);
        }
    })

    return new Basic(metadataManager.getClassMetadata("objectmanager", 1));

}

console.log(new SobaInstance());