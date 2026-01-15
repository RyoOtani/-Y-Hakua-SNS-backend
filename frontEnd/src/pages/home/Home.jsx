import React from 'react'
import './Home.css'
import Topbar from '../../components/topbar/topbarMain'
import Sidebar from '../../components/sidebar/sidebar'
import Timeline from '../../components/timeline/timeline'
import Rightbar from '../../components/rightbar/rightbar'
import Bottombar from '../../components/bottombar/bottombar'



export default function Home() {
  return (
    <>
      <Topbar />
      
      <div className='homeContainer'>
       
        <div className="sidebar">
           <Sidebar />
        </div>
        <div className="HomeConteinnerRightside">
          <Timeline />
          <Rightbar />
        </div>
      </div>
      <div className="bottombar">
        <Bottombar />
      </div>
    </>
  )
}

// export default function Home() {
//   return (
//     <div style={{width: '320px', margin: '0 auto'}}>
//       <Topbar />
//       {/* ...existing code... */}
//       <div className='homeContainer'>
       
//         <div className="sidebar">
//            <Sidebar />
//         </div>
//         <div className="HomeConteinnerRightside">
//           <Timeline />
//           <Rightbar />
//         </div>
//       </div>
      
//         {/* ...existing code... */}
//     </div>
//   )
// }