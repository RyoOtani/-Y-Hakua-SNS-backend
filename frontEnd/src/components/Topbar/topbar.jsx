// import React, { useState } from 'react';
// import { Chat, Notifications, Search } from '@mui/icons-material';
// import './topbar.css';
// import { Link , useNavigate} from 'react-router-dom';
// import { useContext } from 'react';
// import { AuthContext } from '../../state/AuthContext';

// export default function Topbar() {
//   const {user} = useContext(AuthContext);
//   const PUBLIC_FOLDER= process.env.REACT_APP_PUBLIC_FOLDER;

//   const [query, setQuery] = useState('');
//   const navigate = useNavigate();

//   const handleSubmit = (e) => {
//     e.preventDefault();
//     const q = (query || '').toString().trim();
//     if (!q) return;
//     // 検索結果ページへ遷移（Search ページで query を受け取って API を叩く想定）
//     navigate(`/search?q=${encodeURIComponent(q)}`);
//   };


//   return (
//     <div className='topbarContainer'>
//         <div className='topbarLeft'>
//             <Link to='/' style={{ textDecoration: 'none', color: 'inherit' }}>
//                 <span className='logo'>
//                     Y
//                 </span>
//                 <span className='sublogo'>
//                     HakuaSNS
//                 </span>
//             </Link>
//         </div>
//         <div className="topbarCenter">
//             {/* エンターで送信 */}
//             <form className="searchbar" onSubmit={handleSubmit}>
//                 <Search className='searchIcon'/>
//                 <input 
//                     type="text" 
//                     className='searchInput' 
//                     placeholder="興味のあるものを探そう"
//                     value={query}
//                     onChange={(e) => setQuery(e.targetvalue)}
//                 />
//             </form>
//         </div>
//         <div className="topbarRight">
//             <div className="topbarIconItem">
//                 <div className="topbarIconItem">
//                     <Chat />
//                     <span className="topbarIconBadge">1</span>
//                 </div>
//                 <div className="topbarIconItem">
//                     <Notifications />
//                     <span className="topbarIconBadge">2</span>
//                 </div>
//                 <Link to={`/profile/${user.username}`}>
//                     <img src={user.profilePicture 
//                         ? PUBLIC_FOLDER + user.profilePicture 
//                         : PUBLIC_FOLDER + "/person/noAvatar.png"} 
//                         alt="" 
//                         className="topbarImg" 
//                     />
//                 </Link>
//             </div>
//         </div>
        
//     </div>
//   )

// }

import React, { useState, useEffect, useContext } from 'react';
import { Chat, Notifications, Search } from '@mui/icons-material';
import './topbar.css';
import { Link , useNavigate} from 'react-router-dom';
import { AuthContext } from '../../state/AuthContext';

export default function Topbar({ onSearch, initialValue = '' }) {
  const {user} = useContext(AuthContext);
  const PUBLIC_FOLDER= process.env.REACT_APP_PUBLIC_FOLDER || "/images";

  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  // initialValue があればセット（検索ページから戻ってきたとき等）
  useEffect(() => {
    setQuery(initialValue || '');
  }, [initialValue]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const q = (query || '').toString().trim();
    if (!q) return;
    // 親が onSearch を渡していれば呼ぶ（SearchResults が即座に検索できる）
    if (typeof onSearch === 'function') onSearch(q);
    // URL にクエリを付けて遷移
    navigate(`/search?q=${encodeURIComponent(q)}`);
    console.log()
  };

  return (
    <div className='topbarContainer'>
        <div className='topbarLeft'>
            <Link to='/' style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className='logo'>
                    Y
                </span>
                <span className='sublogo'>
                    HakuaSNS
                </span>
            </Link>
        </div>
        <div className="topbarCenter">
            {/* エンターで送信 */}
            <form className="searchbar" onSubmit={handleSubmit}>
                <Search className='searchIcon'/>
                <input 
                    type="text" 
                    className='searchInput' 
                    placeholder="興味のあるものを探そう"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </form>
        </div>
        <div className="topbarRight">
            <div className="topbarIconItem">
                <div className="topbarIconItem1">
                    <Chat />
                    <span className="topbarIconBadge">1</span>
                </div>
                <div className="topbarIconItem1">
                    <Notifications />
                    <span className="topbarIconBadge">2</span>
                </div>
                <Link to={`/profile/${user.username}`}>
                    <img src={user.profilePicture 
                        ? PUBLIC_FOLDER + user.profilePicture 
                        : PUBLIC_FOLDER + "/person/noAvatar.png"} 
                        alt="" 
                        className="topbarImg" 
                    />
                </Link>
            </div>
        </div>
        
    </div>
  )

}