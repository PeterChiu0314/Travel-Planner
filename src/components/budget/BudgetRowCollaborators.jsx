import {useState} from 'react';
import {memberLabel} from '../../lib/budgetFinance.js';
import {collaboratorColor} from '../../lib/collaboratorColors.js';

// Presentation only: the controller remains responsible for expiry and authority.
export function rowCollaborators(entries) {
 const sorted=[...entries].filter(entry=>!entry.own_session).sort((a,b)=>
  Number(b.mode==='edit')-Number(a.mode==='edit') ||
  (b.selected_at||'').localeCompare(a.selected_at||'') || a.user_id.localeCompare(b.user_id));
 const users=new Map();
 for(const entry of sorted)if(!users.has(entry.user_id))users.set(entry.user_id,entry);
 return [...users.values()];
}
export function RowCollaboratorOutline({users}) {
 const owner=users[0];
 return owner?<span className="bw-collaboration-outline" data-user={owner.user_id} data-mode={owner.mode} aria-hidden="true" style={{inset:'1px 1px 1px 5px','--bw-remote-color':collaboratorColor(owner.user_id)}}/>:null;
}
function Avatar({entry,member}) {
 const [failed,setFailed]=useState(false),name=memberLabel(member),src=member?.avatar_url;
 return <span className="bw-peer-avatar" style={{background:collaboratorColor(entry.user_id)}}>{src&&!failed?<img src={src} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:Array.from(name).slice(0,2).join('')}</span>;
}
export function RowCollaboratorAvatars({users,members}) {
 return <div className="bw-peer-avatars" aria-label={`${users.length} 位協作者`}>{users.slice(0,4).map(entry=><Avatar key={entry.user_id} entry={entry} member={members.find(member=>member.user_id===entry.user_id)}/>)}{users.length>4?<span className="bw-peer-avatar bw-peer-more">+{users.length-4}</span>:null}</div>;
}
