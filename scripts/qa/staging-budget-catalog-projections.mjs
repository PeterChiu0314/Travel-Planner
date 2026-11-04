import assert from 'node:assert/strict';
import {captureUndoRemovalContractQuery as query} from './build-undo-removal-staging-packet.mjs';
const start=query.indexOf("'schemaDigest',")+"'schemaDigest',".length,end=query.indexOf(",'roleDigest',",start);
export const schemaExpression=query.slice(start,end);
export const publicationUnion='union all select to_jsonb(p) from pg_publication_tables p';
assert(schemaExpression.includes(publicationUnion));
export const managedPublicationCondition="p.pubname='supabase_realtime_messages_publication' and p.schemaname='realtime'";
// Realtime maintains these dated log partitions itself. Keep every application,
// Auth/Storage catalog and all other publications in the existing projection.
export const stableSchemaExpression=schemaExpression.replace(publicationUnion,`${publicationUnion} where not(${managedPublicationCondition})`);
export const managedPublicationsExpression=`(select coalesce(jsonb_agg(to_jsonb(p) order by p.tablename),'[]'::jsonb) from pg_publication_tables p where ${managedPublicationCondition})`;
