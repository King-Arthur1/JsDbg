"use strict";

Loader.OnLoad(function() {
    DbgObject.AddTypeDescription(Chromium.ChildProcessType("blink_core", "WTF::AtomicString"), "Text", true, UserEditableFunctions.Create((wtfAtomicString) => wtfAtomicString.f("string_").desc("Text")));

    DbgObject.AddTypeDescription(Chromium.ChildProcessType("blink_core", "WTF::AtomicString"), "TextLength", false, UserEditableFunctions.Create((wtfAtomicString) => wtfAtomicString.f("string_").desc("TextLength")));

    DbgObject.AddTypeDescription(Chromium.ChildProcessType("blink_core", "WTF::String"), "Text", true, UserEditableFunctions.Create((wtfString) => wtfString.f("impl_").f("ptr_").desc("Text")));

    DbgObject.AddTypeDescription(Chromium.ChildProcessType("blink_core", "WTF::String"), "TextLength", false, UserEditableFunctions.Create((wtfString) => {
        return wtfString.f("impl_").f("ptr_")
        .then((wtfStringImpl) => !wtfStringImpl.isNull() ? wtfStringImpl.f("length_").val() : 0);
    }));

    DbgObject.AddTypeDescription(Chromium.ChildProcessType("blink_core", "WTF::StringImpl"), "Text", true, UserEditableFunctions.Create((wtfStringImpl) => {
        return !wtfStringImpl.isNull() ? wtfStringImpl.idx(1).as("char", /*disregardSize*/true).string(wtfStringImpl.f("length_")) : "";
    }));

    DbgObject.AddArrayField(
        (type) => {
            return type.name().match(/^WTF::HashTable<(.*)>$/) != null;
        },
        "Pairs",
        (type) => {
            return type.templateParameters()[1];
        },
        UserEditableFunctions.Create((hashTable) => {
            return hashTable.f("table_").array(hashTable.f("table_size_"));
        })
    );

    DbgObject.AddTypeDescription(
        (type) => (type.name().match(/^WTF::KeyValuePair<.*>$/) != null),
        "Pair",
        true,
        UserEditableFunctions.Create((pair) => {
            return Promise.all([pair.f("key").desc(), pair.f("value").desc()])
            .thenAll((first, second) => `{${first}, ${second}}`);
        })
    );
});