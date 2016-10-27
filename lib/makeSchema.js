const Slate = require('slate');
const { Range } = require('immutable');

/**
 * Create a schema for tables
 * @param {String} opts.typeTable The type of table blocks
 * @param {String} opts.typeRow The type of row blocks
 * @param {String} opts.typeCell The type of cell blocks
 * @return {Object} A schema definition with rules to normalize tables
 */
function makeSchema(opts) {
    return {
        rules: [
            tablesContainOnlyRows(opts),
            rowsContainRequiredColumns(opts)
        ]
    };
}

/**
 * @param {String} opts.typeTable The type of table blocks
 * @param {String} opts.typeRow The type of row blocks
 * @param {String} opts.typeCell The type of cell blocks
 * @return {Object} A rule that ensures tables only contain rows and
 * at least one.
 */
function tablesContainOnlyRows(opts) {
    function makeEmptyRow() {
        return Slate.Raw.deserializeNode({
            kind: 'block',
            type: opts.typeRow,
            nodes: [{
                kind: 'block',
                type: opts.typeCell,
                nodes: [{
                    kind: 'text',
                    ranges: [{
                        text: ''
                    }]
                }]
            }]
        });
    }

    const isRow = (node) => node.type === opts.typeRow;

    return {
        match(node) {
            return node.type === opts.typeTable;
        },

        validate(table) {
            // Figure out invalid rows
            const invalids = table.nodes.filterNot(isRow);

            // Figure out valid rows
            const add = invalids.size === table.nodes.size ? [makeEmptyRow()] : [];

            if (invalids.isEmpty() && add.length === 0) {
                return null;
            }

            return {
                invalids,
                add
            };
        },

        /**
         * Replaces the node's children
         * @param {List<Nodes>} value.nodes
         */
        normalize(transform, node, {invalids = [], add = []}) {
            // Remove invalids
            transform = invalids.reduce((t, child) => {
                return t.removeNodeByKey(child.key, { normalize: false });
            }, transform);

            // Add valids
            transform = add.reduce((t, child) => {
                return t.insertNodeByKey(node.key, 0, child);
            }, transform);

            return transform;
        }
    };
}

/**
 * @param {String} opts.typeTable The type of table blocks
 * @param {String} opts.typeRow The type of row blocks
 * @param {String} opts.typeCell The type of cell blocks
 * @return {Object} A rule that ensures rows contains only cells, and
 * as much cells as there is columns in the table.
 */
function rowsContainRequiredColumns(opts) {
    const isRow = (node) => node.type === opts.typeRow;
    const isCell = (node) => node.type === opts.typeCell;
    const countCells = (row) => row.nodes.count(isCell);

    function makeEmptyCell() {
        return Slate.Raw.deserializeNode({
            kind: 'block',
            type: opts.typeCell,
            nodes: [{
                kind: 'text',
                ranges: [{
                    text: ''
                }]
            }]
        });
    }

    return {
        match(node) {
            return node.type === opts.typeTable;
        },

        validate(table) {
            const rows = table.nodes.filter(isRow);

            // The number of column this table has
            const columns = rows.reduce((count, row) => {
                return Math.max(count, countCells(row));
            }, 1); // Min 1 column


            const valid = rows.every(row => columns === countCells(row));
            if (valid) {
                return null;
            }
            // else normalize, by padding with empty cells
            return rows
                .map(row => {
                    const cells = countCells(row);
                    const invalids = row.nodes.filterNot(isCell);

                    // Row is valid: right count of cells and no extra node
                    if (invalids.isEmpty() && cells === columns) {
                        return null;
                    }

                    // Otherwise, remove the invalids and append the missing cells
                    return {
                        row,
                        invalids,
                        add: (columns - cells)
                    };
                })
                .filter(Boolean);
        },

        /**
         * Updates by key every given nodes
         * @param {List<Nodes>} value.toUpdate
         */
        normalize(transform, node, rows) {
            return rows.reduce((tr, { row, invalids, add }) => {
                tr = invalids.reduce((t, child) => {
                    return t.removeNodeByKey(child.key, { normalize: false });
                }, tr);

                tr = Range(0, add).reduce(t => {
                    const cell = makeEmptyCell();
                    return t.insertNodeByKey(row.key, 0, cell, { normalize: false });
                }, tr);

                return tr;
            }, transform);
        }
    };
}

module.exports = makeSchema;