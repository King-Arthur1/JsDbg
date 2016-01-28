"use strict";

// type-explorer.js
// UI for interactive exploration of a type and its fields or extensions.

var TypeExplorer = undefined;
JsDbg.OnLoad(function() {
    function TypeExplorerAggregateType(module, typename, parentField, controller, rerender) {
        this.parentField = parentField;
        this.controller = controller;
        this.searchQuery = "";
        this.backingTypes = [new TypeExplorerSingleType(module, typename, this)];
        this.includeBaseTypes = false;;
        this.preparedForRenderingPromise = null;
    }

    TypeExplorerAggregateType.prototype.module = function() {
        return this.backingTypes[0].module;
    }

    TypeExplorerAggregateType.prototype.typename = function () {
        return this.backingTypes[0].typename;
    }

    TypeExplorerAggregateType.prototype.isType = function (module, typename) {
        var primaryType = this.backingTypes[0];
        return (primaryType.module == module && primaryType.typename == typename);
    }

    TypeExplorerAggregateType.prototype.isExpanded = function() {
        return this.backingTypes[0].isExpanded;
    }

    TypeExplorerAggregateType.prototype.requiresRendering = function() {
        if (this.isExpanded()) {
            return true;
        }

        var requiresRendering = false;
        this.backingTypes.forEach(function(bt) {
            requiresRendering = requiresRendering || bt.requiresRendering();
        });

        return requiresRendering;
    }

    TypeExplorerAggregateType.prototype.prepareForRendering = function() {
        if (this.preparedForRenderingPromise == null) {
            this.preparedForRenderingPromise = this._prepareForRendering();
        }
        return this.preparedForRenderingPromise;
    }

    TypeExplorerAggregateType.prototype._prepareForRendering = function () {
        // Ensure that the base types are loaded and that we've decided whether to include them by default.
        if (this.preparedForRenderingPromise != null) {
            throw new Error("We shouldn't be preparing twice.");
        }

        var that = this;
        return new DbgObject(this.backingTypes[0].module, this.backingTypes[0].typename, 0)
        .baseTypes()
        .then(function (baseTypes) {
            baseTypes.forEach(function (baseType) {
                that.backingTypes.push(new TypeExplorerSingleType(baseType.module, baseType.typeDescription(), that));
            })

            return Promise.map(that.backingTypes, function (bt) { return bt.prepareForRendering(); });
        })
        .then(function () {
            if (that.controller.includeBaseTypesByDefault() || (!that.includeBaseTypes && that.backingTypes[0].fields.length == 0)) {
                that.toggleIncludeBaseTypes();
            }
            that.isPreparedForRendering = true;
        });
    }

    TypeExplorerAggregateType.prototype.toggleExpansion = function() {
        var that = this;
        this.backingTypes.forEach(function (backingType, i) {
            backingType.isExpanded = !backingType.isExpanded && (i == 0 || that.includeBaseTypes);
        });
        if (!this.isExpanded()) {
            // Recursive toggle any child types that are expanded.
            this.backingTypes.forEach(function (backingType) {
                backingType.forEachField(function (field) {
                    if (field.childType != null && field.childType.isExpanded()) {
                        field.childType.toggleExpansion();
                    }
                })
            })
        }
    }

    TypeExplorerAggregateType.prototype.hasBaseTypes = function() {
        return this.backingTypes.length > 1;
    }

    TypeExplorerAggregateType.prototype.toggleIncludeBaseTypes = function() {
        this.includeBaseTypes = !this.includeBaseTypes;
        var that = this;
        var isExpanded = this.backingTypes[0].isExpanded;
        this.backingTypes.forEach(function (backingType, i) {
            if (i > 0) {
                backingType.isExpanded = that.includeBaseTypes && isExpanded;
            }
        });
    }

    TypeExplorerAggregateType.prototype.disableCompletely = function() {
        this.backingTypes.forEach(function (backingType) {
            backingType.disableCompletely();
        })
        this.backingTypes = [];
    }

    function reverseAndFlatten(array) {
        array = array.slice(0);
        array.reverse();
        var result = [];
        array.forEach(function (subArray) {
            result = result.concat(subArray);
        });
        return result;
    }

    TypeExplorerAggregateType.prototype.arrangeFields = function(fields) {
        fields = reverseAndFlatten(fields);
        if (this.searchQuery != "") {
            var searchQuery = this.searchQuery.toLowerCase();
            var augmentedFields = fields.map(function (field) {
                var base = field.name.toLowerCase();
                var context = {};
                if (fuzzyMatch(base, searchQuery, context)) {
                    return {field: field, score: context.score };
                } else {
                    return null;
                }
            });
            augmentedFields = augmentedFields.filter(function (x) { return x != null; });
            augmentedFields.sort(function (a, b) {
                return a.score - b.score;
            });
            fields = augmentedFields.map(function (x) { return x.field; });
        }
        return fields;
    }

    TypeExplorerAggregateType.prototype.getFieldsToRender = function() {
        console.assert(this.isPreparedForRendering);
        return this.arrangeFields(this.backingTypes.map(function (backingType) { return backingType.getFieldsToRender(); }));
    }

    TypeExplorerAggregateType.prototype.getExtendedFieldsToRender = function() {
        console.assert(this.isPreparedForRendering);
        return this.arrangeFields(this.backingTypes.map(function (backingType) { return backingType.getExtendedFieldsToRender(); }));
    }

    TypeExplorerAggregateType.prototype.getArrayFieldsToRender = function() {
        console.assert(this.isPreparedForRendering);
        return this.arrangeFields(this.backingTypes.map(function (backingType) { return backingType.getArrayFieldsToRender(); }));
    }

    TypeExplorerAggregateType.prototype.getDescriptionsToRender = function() {
        console.assert(this.isPreparedForRendering);
        return this.arrangeFields(this.backingTypes.map(function (backingType) { return backingType.getDescriptionsToRender(); }));
    }

    function fuzzyMatch(body, term, context) {
        if (term.length == 0) {
            return true;
        }

        var firstCharacterIndex = body.indexOf(term[0]);
        if (firstCharacterIndex == -1) {
            return false;
        }

        if (context === undefined) {
            context = {};
        }
        if (context.score === undefined) {
            // Initial offset counts much less than subsequent offsets.
            context.score = firstCharacterIndex / 100;
        } else {
            var score = 0;
            if (context.isFirstCharacterTransposed) {
                if (firstCharacterIndex == 0) {
                    // A first character hit means the characters were transposed.
                    score = 4;
                } else {
                    score = firstCharacterIndex - 1;
                }
            } else {
                score = firstCharacterIndex;
            }
            context.score += score;
        }

        // Allow slightly transposed fuzzy matches by grabbing the character before the hit.
        var prefix = "";
        if (firstCharacterIndex > 0 && !(context.isFirstCharacterTransposed && firstCharacterIndex == 1)) {
            prefix = body[firstCharacterIndex - 1];
            context.isFirstCharacterTransposed = true;
        } else {
            context.isFirstCharacterTransposed = false;
        }

        return fuzzyMatch(prefix + body.substr(firstCharacterIndex + 1), term.substr(1), context);
    }

    JsDbg.OnLoad(function() {
        if (typeof Tests !== "undefined") {
            var suite = Tests.CreateTestSuite("TypeExplorer.FuzzyMatch", "Tests for the fuzzy matcher in TypeExplorer.");
            Tests.AddTest(suite, "Basic Matching", function (assert) {
                assert(fuzzyMatch("abc", ""), "[empty string] -> abc");
                assert(fuzzyMatch("abc", "a"), "a -> abc");
                assert(fuzzyMatch("abc", "b"), "b -> abc");
                assert(fuzzyMatch("abc", "c"), "c -> abc");
                assert(fuzzyMatch("abc", "ab"), "ab -> abc");
                assert(fuzzyMatch("abc", "bc"), "bc -> abc");
                assert(fuzzyMatch("abc", "abc"), "abc -> abc");
                assert(!fuzzyMatch("abc", "d"), "d !-> abc");
            });

            Tests.AddTest(suite, "Fuzzy Matching", function (assert) {
                assert(fuzzyMatch("abc", "ac"), "ac -> abc");
                assert(fuzzyMatch("abcde", "ace"), "ace -> abcde");
                assert(!fuzzyMatch("abcde", "afce"), "afce !-> abcde");
                assert(!fuzzyMatch("abcde", "acef"), "acef !-> abcde");
            });

            Tests.AddTest(suite, "Transposed Matching", function (assert) {
                assert(fuzzyMatch("abc", "acb"), "acb -> abc");
                assert(fuzzyMatch("abcde", "acbe"), "acbe -> abcde");
                assert(!fuzzyMatch("abcde", "acbce"), "acbce -> abcde");
                assert(!fuzzyMatch("abcde", "abb"), "abb -> abcde");
                assert(!fuzzyMatch("abcde", "aeb"), "aeb !-> abcde");
                assert(!fuzzyMatch("abcde", "bca"), "bca !-> abcde");
            });
        }
    })

    TypeExplorerAggregateType.prototype.setSearchQuery = function(query) {
        this.searchQuery = query;
    }

    // Represents a single type, not including its base types.
    function TypeExplorerSingleType(module, typename, aggregateType) {
        this.aggregateType = aggregateType;
        this.isExpanded = false;
        this.module = module;
        this.typename = typename;
        this.fields = [];
        this.extendedFields = [];
        this.descriptions = [];
        this.arrayFields = [];
        this.allFieldArrays = [this.fields, this.extendedFields, this.arrayFields, this.descriptions];
        this.preparedForRenderingPromise = null;
    }

    TypeExplorerSingleType.prototype.monitorTypeExtensions = function(typeExtensions, arrayName) {
        var that = this;
        function addTypeExtensionField(name, extension) {
            // For descriptions, ignore the primary descriptions.
            if (extension.isPrimary) {
                return;
            }

            var newField = new TypeExplorerField(name, extension.typeName ? extension.typeName : null, extension.getter, that, arrayName);
            that[arrayName].push(newField);

            if (UserDbgObjectExtensions.GetCreationContext(extension.getter) == that.aggregateType) {
                newField.setIsEnabled(true);
            }
        }

        typeExtensions.getAllExtensions(this.module, this.typename).forEach(function (nameAndExtension) {
            addTypeExtensionField(nameAndExtension.name, nameAndExtension.extension);
        });

        typeExtensions.addListener(this.module, this.typename, function (module, typename, extensionName, extension, operation, argument) {
            if (operation == "add") {
                addTypeExtensionField(extensionName, extension);
            } else if (operation == "remove") {
                that[arrayName] = that[arrayName].filter(function (field) {
                    if (field.name == extensionName) {
                        field.disableCompletely();
                        return false;
                    } else {
                        return true;
                    }
                });
            } else if (operation == "rename") {
                that[arrayName].forEach(function (field) {
                    if (field.name == extensionName) {
                        var wasEnabled = field.isEnabled;
                        field.setIsEnabled(false);
                        field.name = argument;
                        field.setIsEnabled(wasEnabled);
                    }
                })
            } else if (operation == "typechange") {
                that[arrayName].forEach(function (field) {
                    if (field.name == extensionName) {
                        field.setChildType(argument);
                    }
                });
            }

            that.aggregateType.controller.requestRerender();
        });
    }

    TypeExplorerSingleType.prototype.prepareForRendering = function() {
        if (this.preparedForRenderingPromise == null) {
            this.preparedForRenderingPromise = this._prepareForRendering();
        }
        return this.preparedForRenderingPromise;
    }

    TypeExplorerSingleType.prototype._prepareForRendering = function() {
        var that = this;
        return new DbgObject(this.module, this.typename, 0)
        .fields(/*includeBaseTypes*/false)
        .then(function (fields) {
            fields.forEach(function (field) {
                var dereferencedType = field.value.typeDescription().replace(/\**$/, "");
                var getter = function(dbgObject) { return dbgObject.f(field.name); }
                that.fields.push(new TypeExplorerField(field.name, dereferencedType, getter, that, "fields"));
            })

            that.monitorTypeExtensions(DbgObject.ExtendedFields, "extendedFields");
            that.monitorTypeExtensions(DbgObject.TypeDescriptions, "descriptions");
            that.monitorTypeExtensions(DbgObject.ArrayFields, "arrayFields");
        });
    }

    TypeExplorerSingleType.prototype.forEachField = function (f) {
        this.allFieldArrays.forEach(function (a) { a.forEach(f); });
    }

    TypeExplorerSingleType.prototype.considerFieldWhenCollapsed = function (field, shownFields) {
        if (field.isEnabled) {
            shownFields.push(field);
        }
        if (field.childType != null) {
            field.childType.backingTypes.forEach(function (backingType) {
                backingType.forEachField(function (field) {
                    backingType.considerFieldWhenCollapsed(field, shownFields);
                });
            });
        }
    }

    TypeExplorerSingleType.prototype.requiresRendering = function() {
        var requiresRendering = false;
        this.forEachField(function (f) {
            if (f.isEnabled) {
                requiresRendering = true;
            } else if (f.childType != null) {
                requiresRendering = requiresRendering || f.childType.requiresRendering();
            }
        });
        return requiresRendering;
    }

    TypeExplorerSingleType.prototype.selectFieldsToRender = function (allFields) {
        if (this.isExpanded) {
            return allFields;
        } else {
            var shownFields = [];
            var that = this;
            allFields.forEach(function (f) {
                that.considerFieldWhenCollapsed(f, shownFields);
            });
            return shownFields;
        }
    }

    TypeExplorerSingleType.prototype.getFieldsToRender = function () {
        return this.selectFieldsToRender(this.fields);
    }

    TypeExplorerSingleType.prototype.getExtendedFieldsToRender = function() {
        return this.selectFieldsToRender(this.extendedFields);
    }

    TypeExplorerSingleType.prototype.getArrayFieldsToRender = function() {
        return this.selectFieldsToRender(this.arrayFields);
    }

    TypeExplorerSingleType.prototype.getDescriptionsToRender = function() {
        return this.selectFieldsToRender(this.descriptions);
    }

    TypeExplorerSingleType.prototype.disableCompletely = function() {
        // Disable all the fields and trash the arrays.
        this.forEachField(function (f) {
            f.disableCompletely();
        });
        this.allFieldArrays.forEach(function (a) {
            a.length = 0;
        });
    }

    function TypeExplorerField(name, fieldTypeName, getter, parentType, sourceInParentType) {
        this.name = name;
        this.parentType = parentType;
        this.getter = getter;
        this.nestedFieldGetter = this.getNestedField.bind(this);
        this.sourceInParentType = sourceInParentType;
        this.isEnabled = false;
        this.clientContext = {};
        this.childType = null;

        if (fieldTypeName instanceof Function) {
            fieldTypeName = fieldTypeName(this.parentType.typename);
        }
        this.setChildType(fieldTypeName);
    }

    TypeExplorerField.prototype.isArray = function() {
        return this.sourceInParentType == "arrayFields";
    }

    TypeExplorerField.prototype.getNestedField = function(dbgObject, element) {
        var that = this;
        function checkType(result) {
            // Check that the field returned the proper type.
            if (!(result instanceof DbgObject)) {
                var resultString = result.toString();
                if (Array.isArray(result)) {
                    resultString = "an array";
                }
                throw new Error("The field \"" + that.name + "\" should have returned a DbgObject but instead returned " + resultString + ".");
            }

            return result.isType(that.childType.typename())
            .then(function (isType) {
                if (!isType) {
                    throw new Error("The field \"" + that.name + "\" was supposed to be type \"" + that.childType.typename() + "\" but was unrelated type \"" + result.typeDescription() + "\".");
                } else {
                    return result;
                }
            });
        }

        function getFromParentDbgObject(parentDbgObject) {
            parentDbgObject = parentDbgObject.as(that.parentType.typename);
            if (that.childType == null) {
                return that.getter(parentDbgObject, element);
            }

            return Promise.as(that.getter(parentDbgObject))
            .then(function(result) {
                if (that.isArray()) {
                    if (!Array.isArray(result)) {
                        throw new Error("The array \"" + that.name + "\" did not return an array, but returned \"" + result + "\"");
                    }
                    return Promise.map(Promise.join(result), checkType);
                } else {
                    return checkType(result);
                }
            });
        }

        function getFromParentResult(parentResult) {
            if (Array.isArray(parentResult)) {
                return Promise.map(parentResult, getFromParentResult);
            } else {
                return getFromParentDbgObject(parentResult);
            }
        }

        var parentField = this.parentType.aggregateType.parentField;
        if (parentField == null) {
            return Promise.as(dbgObject).then(getFromParentDbgObject);
        } else {
            return parentField.getNestedField(dbgObject).then(getFromParentResult);
        }
    }

    TypeExplorerField.prototype.isEditable = function() {
        return UserDbgObjectExtensions.IsEditableExtension(this.getter);
    }

    TypeExplorerField.prototype.canBeDeleted = function() {
        return UserDbgObjectExtensions.IsUserExtension(this.getter);
    }

    TypeExplorerField.prototype.beginEditing = function() {
        if (this.isEditable()) {
            UserDbgObjectExtensions.Edit(this.getter);
        }
    }

    TypeExplorerField.prototype.delete = function() {
        if (this.canBeDeleted()) {
            UserDbgObjectExtensions.Delete(this.getter);
        }
    }

    TypeExplorerField.prototype.getChildTypeName = function() {
        return this.childType == null ? null : this.childType.typename();
    }

    TypeExplorerField.prototype.disableCompletely = function() {
        this.setIsEnabled(false);
        if (this.childType != null) {
            this.childType.disableCompletely();
        }
    }

    TypeExplorerField.prototype.setIsEnabled = function(isEnabled) {
        if (!this.parentType.aggregateType.controller.allowFieldSelection()) {
            return;
        }

        if (isEnabled != this.isEnabled) {
            this.isEnabled = isEnabled;
            this.parentType.aggregateType.controller._notifyFieldChange(this);
        }
    }

    TypeExplorerField.prototype.setChildType = function(newTypeName) {
        if (this.childType != null) {
            this.childType.disableCompletely();
        }

        if (newTypeName != null) {
            this.childType = new TypeExplorerAggregateType(this.parentType.module, newTypeName, this, this.parentType.aggregateType.controller);
        } else {
            this.childType = null;
        }
    }

    function TypeExplorerController(dbgObject, options) {
        this.container = null;
        this.dbgObject = dbgObject;
        this.options = options;
        this.rootType = new TypeExplorerAggregateType(dbgObject.module, dbgObject.typeDescription(), null, this);
    }

    TypeExplorerController.prototype.render = function(explorerContainer) {
        explorerContainer.classList.add("type-explorer");

        this.container = document.createElement("div");
        explorerContainer.appendChild(this.container);
        this.hasRequestedRerender = false;

        var that = this;
        return UserDbgObjectExtensions.EnsureLoaded()
        .then(function () {
            that.container.classList.add("collapsed");
            return that._renderType(that.rootType, that.container);
        });
    }

    TypeExplorerController.prototype.requestRerender = function() {
        if (this.hasRequestedRerender) {
            return;
        }

        this.hasRequestedRerender = true;
        var that = this;
        window.requestAnimationFrame(function () {
            if (that.hasRequestedRerender) {
                that.hasRequestedRerender = false;
                that._renderType(that.rootType, that.container);
            }
        });
    }

    TypeExplorerController.prototype.enableField = function(path) {
        var that = this;
        return UserDbgObjectExtensions.EnsureLoaded()
        .then(function() {
            return that._enableRemainingPath(that.rootType, path, 0);
        });
    }

    TypeExplorerController.prototype.toggleExpansion = function() {
        this.rootType.toggleExpansion();
        this.requestRerender();
    }

    TypeExplorerController.prototype._computePath = function(field) {
        var path = [];
        this._appendPath(field, path);
        path.reverse();
        return path;
    }

    TypeExplorerController.prototype._appendPath = function (obj, path) {
        if (obj instanceof TypeExplorerField) {
            path.push(obj.name);
            path.push(obj.sourceInParentType);
            return this._appendPath(obj.parentType, path);
        } else if (obj instanceof TypeExplorerSingleType) {
            path.push(obj.typename);
            return this._appendPath(obj.aggregateType, path);
        } else if (obj instanceof TypeExplorerAggregateType) {
            if (obj.parentField != null) {
                return this._appendPath(obj.parentField, path);
            }
        }
    }

    TypeExplorerController.prototype._enableRemainingPath = function (obj, path, currentIndex) {
        var that = this;
        if (currentIndex == path.length) {
            if (obj instanceof TypeExplorerField) {
                obj.setIsEnabled(true);
            }
        } else {
            if (obj instanceof TypeExplorerField) {
                return that._enableRemainingPath(obj.childType, path, currentIndex);
            } else if (obj instanceof TypeExplorerSingleType) {
                var collection = path[currentIndex];
                collection = obj[collection];
                currentIndex++;

                return Promise.as(collection)
                .then(function (collection) {
                    for (var i = 0; i < collection.length; ++i) {
                        if (collection[i].name == path[currentIndex]) {
                            return that._enableRemainingPath(collection[i], path, currentIndex + 1);
                        }
                    }
                })
            } else if (obj instanceof TypeExplorerAggregateType) {
                return obj.prepareForRendering()
                .then(function () {
                    for (var i = 0; i < obj.backingTypes.length; ++i) {
                        if (obj.backingTypes[i].typename == path[currentIndex]) {
                            return that._enableRemainingPath(obj.backingTypes[i], path, currentIndex + 1);
                        }
                    }
                });
            }
        }
    }

    TypeExplorerController.prototype.allowFieldSelection = function() {
        return !!this.options.onFieldChange;
    }

    TypeExplorerController.prototype.allowFieldRendering = function() {
        return !this.dbgObject.isNull();
    }

    TypeExplorerController.prototype.includeBaseTypesByDefault = function() {
        return !!this.options.includeBaseTypesByDefault;
    }

    TypeExplorerController.prototype._notifyFieldChange = function(field, changeType) {
        if (this.options.onFieldChange) {
            this.options.onFieldChange(this.dbgObject, this._getFieldForNotification(field), changeType);
        }
    }

    TypeExplorerController.prototype._getFieldForNotification = function(field) {
        var result = {
            context: field.clientContext,
            getter: field.nestedFieldGetter,
            allGetters: [],
            isEnabled: field.isEnabled,
            names: [],
            path: this._computePath(field)
        };

        do {
            result.allGetters.push(field.getter);
            result.names.push(field.name);
            field = field.parentType.aggregateType.parentField;
        } while (field != null);

        result.allGetters.reverse();
        result.names.reverse();

        return result;
    }

    TypeExplorerController.prototype._renderType = function(type, typeContainer) {
        if (typeContainer == null) {
            return Promise.as(null);
        }

        if (!typeContainer.currentType) {
            typeContainer.classList.add("fields-container");
            typeContainer.innerHTML = [
                "<input class=\"small-input\" placeholder=\"Search...\" type=\"search\">",
                "<button class=\"small-button base-types\"></button>",
                "<button class=\"small-button extend\">Extend</button>",
                "<div></div>"
            ].join("");
            typeContainer.querySelector("input").addEventListener("input", function () {
                typeContainer.currentType.setSearchQuery(filterTextBox.value);
                typeContainer.currentType.controller._renderFieldList(typeContainer.currentType, fieldListContainer);
            });
            typeContainer.querySelector(".base-types").addEventListener("click", function() {
                var type = typeContainer.currentType;
                type.toggleIncludeBaseTypes();
                showBaseTypesControl.textContent = type.includeBaseTypes ? "Exclude Base Types" : "Include Base Types";
                type.controller._renderFieldList(type, fieldListContainer);
            });
            typeContainer.querySelector(".extend").addEventListener("click", function() {
                var type = typeContainer.currentType;
                UserDbgObjectExtensions.Create(type.module(), type.typename(), type);
            });
        }
        typeContainer.currentType = type;
        var filterTextBox = typeContainer.firstChild;
        var showBaseTypesControl = filterTextBox.nextSibling;
        var newExtensionButton = showBaseTypesControl.nextSibling;
        var fieldListContainer = newExtensionButton.nextSibling;

        if (!type.requiresRendering()) {
            typeContainer.style.display = "none";
            return Promise.as(null);
        }

        var that = this;
        return type.prepareForRendering()
        .then(function () {
            if (!type.isExpanded()) {
                typeContainer.classList.add("collapsed");
            } else {
                typeContainer.classList.remove("collapsed");
                filterTextBox.value = type.searchQuery;

                if (type.hasBaseTypes()) {
                    showBaseTypesControl.textContent = type.includeBaseTypes ? "Exclude Base Types" : "Include Base Types";
                    showBaseTypesControl.style.display = "";
                } else {
                    showBaseTypesControl.style.display = "none";
                }
            }

            return that._renderFieldList(type, fieldListContainer);
        })
        .then(function() {
            typeContainer.style.display = "";
            if (type.isExpanded()) {
                filterTextBox.focus();
            }
        })
    }

    function findFieldNameCollisions(fields, type) {
        var names = {};
        var collisions = {};

        fields.forEach(function (f) {
            if (f.parentType.aggregateType != type) {
                return;
            }

            if (f.name in names) {
                collisions[f.name] = true;
            } else {
                names[f.name] = true;
            }
        })

        return collisions;
    }

    TypeExplorerController.prototype._renderFieldList = function(type, fieldsContainer) {
        var that = this;

        var fields = type.getFieldsToRender();
        var extendedFields = type.getExtendedFieldsToRender();
        var arrayFields = type.getArrayFieldsToRender();
        var descriptions = type.getDescriptionsToRender()
        extendedFields = extendedFields.concat(arrayFields).concat(descriptions);

        // Find any collisions in the fields.
        var fieldCollisions = findFieldNameCollisions(fields, type);
        var extendedFieldCollisions = findFieldNameCollisions(extendedFields, type);
        
        var existingFields = Array.prototype.slice.call(fieldsContainer.childNodes).filter(function (x) { return x.tagName == "DIV"; });
        var existingFieldIndex = 0;
        function getNextFieldContainer() {
            var fieldContainer = null;
            if (existingFieldIndex < existingFields.length) {
                fieldContainer = existingFields[existingFieldIndex++];
                fieldContainer.style.display = "";
            } else {
                fieldContainer = document.createElement("div");
                fieldsContainer.appendChild(fieldContainer);
            }
            return fieldContainer;
        }

        return Promise.map(extendedFields, function (extendedField) {
            return that._renderField(extendedField, type, getNextFieldContainer(), extendedFieldCollisions);
        })
        .then(function() {
            var hr = Array.prototype.slice.call(fieldsContainer.childNodes).filter(function (x) { return x.tagName == "HR"; }).pop();
            if (!hr) {
                hr = document.createElement("hr");
                fieldsContainer.appendChild(hr);
            }

            if (extendedFields.length > 0 && type.isExpanded()) {
                if (existingFieldIndex < existingFields.length) {
                    fieldsContainer.insertBefore(hr, existingFields[existingFieldIndex]);
                } else {
                    fieldsContainer.appendChild(hr);
                }
                hr.style.display = "";
            } else {
                hr.style.display = "none";
            }

            return Promise.map(fields, function (field) {
                return that._renderField(field, type, getNextFieldContainer(), fieldCollisions);
            })
        })
        .then(function () {
            while (existingFieldIndex < existingFields.length) {
                var container = existingFields[existingFieldIndex];
                container.style.display = "none";
                ++existingFieldIndex;
            }
        })
    }

    function realizeDbgObjectOrArray(dbgObjectOrArray) {
        if (dbgObjectOrArray instanceof DbgObject) {
            if (dbgObjectOrArray.isNull()) {
                return "nullptr";
            } else {
                return dbgObjectOrArray.desc();
            }
        } else if (Array.isArray(dbgObjectOrArray)) {
            return Promise.map(dbgObjectOrArray, realizeDbgObjectOrArray);
        } else {
            return Promise.as(dbgObjectOrArray);
        }
    }

    function renderRealizedContent(realizedContent, node) {
        node.innerHTML = "";
        if (realizedContent instanceof Node) {
            node.appendChild(realizedContent);
        } else if (Array.isArray(realizedContent)) {
            node.appendChild(document.createTextNode("["));
            realizedContent.forEach(function (content, i) {
                var ib = document.createElement("div");
                ib.style.display = "inline-block";
                node.appendChild(ib);
                renderRealizedContent(content, ib);
                if (i < realizedContent.length - 1) {
                    node.appendChild(document.createTextNode(", "));
                }
            })
            node.appendChild(document.createTextNode("]"));
        } else {
            node.innerHTML = realizedContent;
        }
    }

    TypeExplorerController.prototype._renderField = function (field, renderingType, fieldContainer, nameCollisions) {
        if (!fieldContainer.currentField) {
            fieldContainer.innerHTML = [
                "<label>",
                    "<input type=\"checkbox\">",
                    "<span class=\"field-name\"></span>",
                    "<span class=\"field-type\"></span>",
                    "<button class=\"small-button edit-button\">Edit</button>",
                    "<button class=\"small-button delete-button\">Delete</button>",
                    "<div class=\"rendering\"></div>",
                "</label>",
                "<div class=\"subfields\"></div>"
            ].join("");

            if (!this.allowFieldSelection()) {
                fieldContainer.querySelector("input").style.display = "none";
            }

            fieldContainer.querySelector("input").addEventListener("change", function () {
                fieldContainer.currentField.setIsEnabled(input.checked);
            });
            fieldContainer.querySelector(this.allowFieldSelection() ? ".field-type" : "label").addEventListener("click", function(e) {
                var field = fieldContainer.currentField;
                if (field.childType != null) {
                    e.preventDefault();
                    field.childType.toggleExpansion();
                    subFieldsContainer.classList.toggle("collapsed");
                    field.parentType.aggregateType.controller._renderType(field.childType, subFieldsContainer);
                }
            })
            fieldContainer.querySelector(".edit-button").addEventListener("click", function() {
                fieldContainer.currentField.beginEditing();
            });
            fieldContainer.querySelector(".delete-button").addEventListener("click", function() {
                fieldContainer.currentField.delete();
            });

            if (!this.allowFieldRendering()) {
                fieldContainer.querySelector(".rendering").style.display = "none";
            }
        }

        fieldContainer.currentField = field;
        var label = fieldContainer.firstChild;
        var subFieldsContainer = label.nextSibling;
        var input = label.firstChild;
        var fieldNameContainer = input.nextSibling;
        var fieldTypeContainer = fieldNameContainer.nextSibling;
        var editButton = fieldTypeContainer.nextSibling;
        var deleteButton = editButton.nextSibling;
        var rendering = deleteButton.nextSibling;

        var currentType = field.parentType;
        var areAllTypesExpanded = true;
        while (areAllTypesExpanded && currentType != null) {
            areAllTypesExpanded = currentType.isExpanded;
            currentType = currentType.aggregateType.parentField != null ? currentType.aggregateType.parentField.parentType : null;
        }

        input.checked = field.isEnabled;

        var currentField = field;
        var names = [field.name];
        while (currentField.parentType.aggregateType != renderingType) {
            currentField = currentField.parentType.aggregateType.parentField;
            names.push(currentField.name);
        }
        if (currentField.name in nameCollisions) {
            names[names.length - 1] = (currentField.parentType.typename) + "::" + names[names.length - 1];
        }

        fieldNameContainer.textContent = names.reverse().join(".");
        
        var fieldTypeName = field.getChildTypeName();
        if (fieldTypeName != null) {
            if (areAllTypesExpanded) {
                fieldTypeContainer.textContent = fieldTypeName + (field.isArray() ? "[]" : "");
                fieldTypeContainer.style.display = "";
            } else {
                fieldTypeContainer.style.display = "none";
            }
            label.title = fieldTypeName + " " + field.name;
        } else {
            label.title = field.name;
            fieldTypeContainer.style.display = "none";
        }

        editButton.style.display = field.isEditable() ? "" : "none";
        deleteButton.style.display = field.canBeDeleted() ? "" : "none";

        var renderingPromise = Promise.as(null);
        if (this.allowFieldRendering()) {
            renderingPromise = field.getNestedField(this.dbgObject, rendering)
            .then(function (fieldValue) {
                return realizeDbgObjectOrArray(fieldValue);
            })
            .then(
                function (result) {
                    if (result !== undefined) {
                        renderRealizedContent(result, rendering);
                    }
                }, function (err) {
                    renderRealizedContent(err, rendering);
                }
            );
        }

        if (field.childType == null || !areAllTypesExpanded) {
            subFieldsContainer.style.display = "none";
            return renderingPromise;
        }

        var that = this;
        return renderingPromise.then(function() {
            return that._renderType(field.childType, subFieldsContainer);
        })
    }

    function create(dbgObject, options) {
        return new TypeExplorerController(dbgObject, options);
    }

    TypeExplorer = {
        Create: create
    };
});