import cytoscape from 'cytoscape';
import type {ElementDefinition,Core} from 'cytoscape';
self.onmessage=(event:MessageEvent<{elements:ElementDefinition[];randomize:boolean}>)=>{
 let cy:Core|undefined;
 try{
  cy=cytoscape({headless:true,elements:event.data.elements});
  cy.layout({name:'cose',animate:false,randomize:event.data.randomize,fit:false,nodeRepulsion:()=>12000,idealEdgeLength:()=>125,nodeOverlap:20,componentSpacing:100,numIter:400}).run();
  self.postMessage({positions:cy.nodes().map(n=>({id:n.id(),position:n.position()}))});
 }catch{self.postMessage({error:'Unable to arrange these notes. Retry the layout or use the accessible list.'});}
 finally{cy?.destroy();}
};
