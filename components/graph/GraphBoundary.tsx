'use client';
import {Component,type ReactNode} from 'react';
export class GraphBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<section className="empty" role="alert"><h2>The graph could not load.</h2><p>Your saved notes are safe. Reload the application to retry loading the graph.</p><button onClick={()=>window.location.reload()}>Retry</button></section>:this.props.children;}
}
