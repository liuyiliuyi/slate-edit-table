// @flow
import { Block, Text, type Change, type Node } from 'slate';
import { Range, List } from 'immutable';

import createAlign from '../createAlign';
import type Options from '../options';

type Normalizer = Change => any;
type Validator = Node => void | Normalizer;

// Old format for Slate rules
type Rule = {
    match: Node => boolean,
    validate: Node => any,
    normalize: (Change, Node, any) => Normalizer
};

/**
 * Returns a validateNodee function, handling validation specific to tables that
 * cannot be expressed using the schema.
 */
function validateNode(opts: Options): Validator {
    const rules = [
        // tablesContainOnlyRows(opts),
        rowsContainRequiredColumns(opts),
        tableContainAlignData(opts)
    ];
    const validators = rules.map(toValidateNode);

    return function validateTableNode(node) {
        let changer;
        validators.find(validator => {
            changer = validator(node);
            return Boolean(changer);
        });

        return changer;
    };
}

// Convert an old rule definition to an individual plugin with on "validateNode"
function toValidateNode(rule: Rule): Validator {
    return function validateRule(node: Node) {
        if (!rule.match(node)) {
            return undefined;
        }
        const validationResult = rule.validate(node);
        if (validationResult == null) {
            return undefined;
        }

        return change => rule.normalize(change, node, validationResult);
    };
}

/**
 * Rule that ensures tables only contain rows and at least one.
 */
function tablesContainOnlyRows(opts: Options): Rule {
    const isRow = node => node.type === opts.typeRow;

    return {
        match(node) {
            return node.type === opts.typeTable;
        },

        validate(table) {
            // Figure out invalid rows
            const invalids = table.nodes.filterNot(isRow);

            // Figure out valid rows
            const add =
                invalids.size === table.nodes.size ? [makeEmptyRow(opts)] : [];

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
         */
        normalize(
            change,
            node,
            { invalids = [], add = [] }: { invalids: Node[], add: Node[] }
        ) {
            // Remove invalids
            invalids.forEach(child =>
                change.removeNodeByKey(child.key, { normalize: false })
            );

            // Add valids
            add.forEach(child => change.insertNodeByKey(node.key, 0, child));

            return change;
        }
    };
}

/**
 * A rule that ensures rows contains only cells, and
 * as much cells as there is columns in the table.
 */
function rowsContainRequiredColumns(opts: Options): Rule {
    const isRow = node => node.type === opts.typeRow;
    const isCell = node => node.type === opts.typeCell;
    const countCells = row => row.nodes.count(isCell);

    return {
        match(node) {
            return node.type === opts.typeTable;
        },

        validate(table) {
            const rows = table.nodes.filter(isRow);

            // The number of column this table has
            const columns = rows.reduce(
                (count, row) => Math.max(count, countCells(row)),
                1
            ); // Min 1 column

            // else normalize, by padding with empty cells
            const invalidRows = rows
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
                        add: columns - cells
                    };
                })
                .filter(Boolean);

            return invalidRows.size > 0 ? invalidRows : null;
        },

        /**
         * Updates by key every given nodes
         */
        normalize(change, node, rows: Node[]) {
            rows.forEach(({ row, invalids, add }) => {
                invalids.forEach(child => {
                    change.removeNodeByKey(child.key, { normalize: false });
                });

                Range(0, add).forEach(() => {
                    const cell = makeEmptyCell(opts);
                    change.insertNodeByKey(row.key, 0, cell, {
                        normalize: false
                    });
                });
            });

            return change;
        }
    };
}

/**
 * A rule that ensures table node has all align data
 */
function tableContainAlignData(opts: Options): Rule {
    return {
        match(node) {
            return node.type === opts.typeTable;
        },

        validate(table) {
            const align = table.data.get('align', []);
            const row = table.nodes.first();
            if (row.type !== opts.typeRow) {
                return null;
            }
            // console.log(JSON.stringify(table.toJSON(), null, 2));
            const columns = row.nodes.size;

            return align.length == columns ? null : { align, columns };
        },

        /**
         * Updates by key the table to add the data
         */
        normalize(
            change,
            node,
            { align, columns }: { align: string[], columns: number }
        ) {
            return change.setNodeByKey(
                node.key,
                {
                    data: node.data.set('align', createAlign(columns, align))
                },
                { normalize: false }
            );
        }
    };
}

function makeEmptyCell(opts: Options): Block {
    return Block.create({
        type: opts.typeCell,
        nodes: List([Text.create('')])
    });
}

function makeEmptyRow(opts: Options): Block {
    return Block.create({
        type: opts.typeRow,
        nodes: List([makeEmptyCell(opts)])
    });
}

export default validateNode;