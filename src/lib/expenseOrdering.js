export const expenseCategories = ['機票','交通','住宿','門票','餐飲','購物','其他'];

export function insertExpenseOrder(ids, source, target, side) {
 const next=ids.filter(id=>id!==source);
 const index=target==null?next.length:next.indexOf(target);
 if(index<0)return null;
 next.splice(index+(side==='after'?1:0),0,source);
 return next;
}

export function orderedExpenseRows(rows, positions) {
 return [...rows].sort((a,b)=>(positions?.[a.id]?.position??Infinity)-(positions?.[b.id]?.position??Infinity));
}

export function expenseOrderProjection(rows,categories,source,target,side) {
 if(source.kind==='category'){
  return {rows,categories:insertExpenseOrder(categories,source.id,target.id,side)||categories};
 }
 const moving=rows.find(row=>row.id===source.id);
 const category=target.category;
 const destination=rows.filter(row=>row.category===category);
 const ordered=insertExpenseOrder(destination.map(row=>row.id),source.id,target.kind==='item'?target.id:null,side);
 if(!moving||!ordered)return {rows,categories};
 const byId=new Map(destination.map(row=>[row.id,row]));
 byId.set(moving.id,{...moving,category});
 return {categories,rows:[...rows.filter(row=>row.category!==category&&row.id!==source.id),...ordered.map(id=>byId.get(id))]};
}
