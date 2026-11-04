import { listenPeer } from '../../src/transport.ts';
import type { PeerRecord } from '../../src/protocol.ts';
const record: PeerRecord = JSON.parse(process.env.TEST_PEER_RECORD!);
const server = await listenPeer({ record, token: process.env.TEST_PEER_TOKEN!, getView: () => ({...record,activity:'idle',paused:false}), onFrame: async frame => { process.send?.({type:'received',frame}); return {messageId:frame.messageId,status:'accepted'}; } });
process.send?.({type:'ready'});
process.on('message', async message => { if(message==='stop'){await server.close(); process.disconnect();} });
