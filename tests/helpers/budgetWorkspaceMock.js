import {lifecycleBackend,enableLifecycle,boot} from './budgetLifecycleMock.js';
export {boot,enableLifecycle as enableWorkspace};
export function workspaceBackend(){
 const db=lifecycleBackend(),request=db.request.bind(db);db.undoCalls=[];
 db.request=async req=>{if(req.op==='rpc'&&/undo|inverse/i.test(req.name))db.undoCalls.push(req);return request(req);};
 return db;
}
