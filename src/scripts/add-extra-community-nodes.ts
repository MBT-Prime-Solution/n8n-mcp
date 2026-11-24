#!/usr/bin/env node
/**
 * Fork addition (MBT-Prime-Solution): upsert the community packages listed in
 * EXTRA_COMMUNITY_PACKAGES (src/loaders/node-loader.ts) into data/nodes.db with
 * full schemas, without touching any other row.
 *
 * Unlike `npm run rebuild`, this keeps the upstream database (core node docs,
 * community READMEs, AI summaries) intact. Rows are saved as community nodes
 * (is_community = 1), so a later upstream `rebuild` preserves them.
 *
 * Usage: npm run build && npm run add:extra-community
 */
import * as path from 'path';
import { createDatabaseAdapter } from '../database/database-adapter';
import { N8nNodeLoader } from '../loaders/node-loader';
import { NodeParser, ParsedNode, ParsedNodeVersion } from '../parsers/node-parser';
import { NodeRepository, CommunityNodeFields } from '../database/node-repository';
import { ToolVariantGenerator } from '../services/tool-variant-generator';

async function main(): Promise<void> {
  const dbPath = process.env.NODE_DB_PATH || path.join(process.cwd(), 'data', 'nodes.db');
  const db = await createDatabaseAdapter(dbPath);
  const repository = new NodeRepository(db);
  const loader = new N8nNodeLoader();
  const parser = new NodeParser();
  const toolVariantGenerator = new ToolVariantGenerator();

  const loaded = await loader.loadExtraCommunityNodes();
  if (loaded.length === 0) {
    throw new Error('No nodes loaded from EXTRA_COMMUNITY_PACKAGES - are the packages installed?');
  }

  const fetchedAt = new Date().toISOString();
  let saved = 0;

  for (const { packageName, nodeName, NodeClass, community } of loaded) {
    const communityFields: CommunityNodeFields = {
      isCommunity: true,
      isVerified: false,
      npmPackageName: packageName,
      npmVersion: community?.npmVersion,
      authorName: community?.authorName,
      authorGithubUrl: community?.repositoryUrl,
      communityFetchedAt: fetchedAt,
    };

    // NodeParser shortens package prefixes the way it does for n8n's own packages
    // (n8n-nodes-foo -> nodes-foo); n8n itself uses the full npm name for community
    // nodes, which is also how upstream's community rows are stored.
    const toFullType = (nodeType: string): string => {
      const dot = nodeType.indexOf('.');
      return dot === -1 ? nodeType : `${packageName}${nodeType.slice(dot)}`;
    };

    const base = parser.parse(NodeClass, packageName);
    const parsed = { ...base, nodeType: toFullType(base.nodeType), ...communityFields };
    const versions: ParsedNodeVersion[] = parser
      .parseVersions(NodeClass, packageName)
      .map((version) => ({ ...version, nodeType: toFullType(version.nodeType) }));
    const rows: Array<ParsedNode & CommunityNodeFields> = [parsed];

    // n8n exposes a `<name>Tool` variant for every node with usableAsTool: true
    if (parsed.isAITool && !parsed.isTrigger) {
      const toolVariant = toolVariantGenerator.generateToolVariant(parsed);
      if (toolVariant) {
        parsed.hasToolVariant = true;
        rows.push({ ...toolVariant, ...communityFields });
      }
    }

    db.transaction(() => {
      for (const row of rows) {
        repository.saveNode(row);
      }
      for (const version of versions) {
        repository.saveNodeVersion({
          nodeType: version.nodeType,
          version: version.version,
          packageName: version.packageName,
          displayName: version.displayName,
          description: version.description,
          category: version.category,
          isCurrentMax: version.isCurrentMax,
          propertiesSchema: version.properties,
          operations: version.operations,
          credentialsRequired: version.credentials,
          outputs: version.outputs,
          addedProperties: version.addedProperties,
          deprecatedProperties: version.deprecatedProperties,
        });
      }
    });

    for (const row of rows) {
      console.log(`✅ ${row.nodeType} [Props: ${row.properties.length}, Ops: ${row.operations.length}]`);
      saved++;
    }
  }

  // Same as rebuild.ts: re-index every row so search_nodes sees the new ones
  db.prepare("INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')").run();
  console.log(`\n💾 Saved ${saved} community node row(s); FTS5 index rebuilt`);

  if (typeof (db as any).close === 'function') {
    (db as any).close();
  }
}

main().catch((error) => {
  console.error('❌ add-extra-community-nodes failed:', error);
  process.exit(1);
});
