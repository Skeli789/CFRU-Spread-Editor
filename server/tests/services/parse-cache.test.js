/**
 * Test file for the parse cache.
 * Tests hits, invalidation by inputs, independent slots and recovery from unreadable cache files.
 */

const { expect } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createParseCache, hashMacros } = require("../../services/parse-cache");

const NAMESPACE = "spread-file";


describe("Parse Cache", () =>
{
    let directory;
    let cache;
    let creates;

    const create = (value) => () =>
    {
        creates++;
        return value;
    };

    beforeEach(() =>
    {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "cfru-editor-cache-"));
        cache = createParseCache({ directory });
        creates = 0;
    });

    afterEach(() =>
    {
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it("should reuse a result while its inputs are unchanged", async () =>
    {
        expect(await cache.getOrCreate(NAMESPACE, "a.h", ["v1", "hash-1"], create({ sets: [1] }))).to.deep.equal({ sets: [1] });
        expect(await createParseCache({ directory }).getOrCreate(NAMESPACE, "a.h", ["v1", "hash-1"], create({ sets: [2] }))).to.deep.equal({ sets: [1] });
        expect(creates).to.equal(1);
    });

    it("should rebuild and replace a result when an input changes", async () =>
    {
        await cache.getOrCreate(NAMESPACE, "a.h", ["v1", "hash-1"], create("old"));
        expect(await cache.getOrCreate(NAMESPACE, "a.h", ["v1", "hash-2"], create("new"))).to.equal("new");
        expect(await cache.getOrCreate(NAMESPACE, "a.h", ["v1", "hash-2"], create("unused"))).to.equal("new");
        expect(fs.readdirSync(path.join(directory, NAMESPACE))).to.have.length(1);
        expect(creates).to.equal(2);
    });

    it("should keep slots and namespaces independent", async () =>
    {
        await cache.getOrCreate(NAMESPACE, "a.h", ["hash"], create("a"));
        await cache.getOrCreate(NAMESPACE, "b.h", ["hash"], create("b"));
        await cache.getOrCreate("trainer-tables", "a.h", ["hash"], create("trainers"));
        expect(await cache.getOrCreate(NAMESPACE, "a.h", ["hash"], create("unused"))).to.equal("a");
        expect(creates).to.equal(3);
    });

    it("should rebuild a result whose cache file is unreadable", async () =>
    {
        await cache.getOrCreate(NAMESPACE, "a.h", ["hash"], create("first"));
        const [name] = fs.readdirSync(path.join(directory, NAMESPACE));
        fs.writeFileSync(path.join(directory, NAMESPACE, name), "{ not json");

        expect(await cache.getOrCreate(NAMESPACE, "a.h", ["hash"], create("second"))).to.equal("second");
    });

    it("should still return results when the cache cannot be written", async () =>
    {
        const failing = createParseCache({ directory, fileSystem: { ...fs.promises, writeFile: async () => { throw new Error("Disk full"); } } });
        expect(await failing.getOrCreate(NAMESPACE, "a.h", ["hash"], create("value"))).to.equal("value");
        expect(fs.existsSync(path.join(directory, NAMESPACE)) ? fs.readdirSync(path.join(directory, NAMESPACE)) : []).to.deep.equal([]);
    });

    it("should hash macros by name and value but not by where they were defined", () =>
    {
        const macros = (line, body) => new Map([["UNBOUND", { body: "", functionLike: false, line }], ["LEVEL", { body, functionLike: false, line: 2 }]]);
        expect(hashMacros(macros(1, "2"))).to.equal(hashMacros(macros(9, "2")));
        expect(hashMacros(macros(1, "2"))).to.not.equal(hashMacros(macros(1, "3")));
    });
});
