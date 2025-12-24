import { Home, Notifications, MessageRounded, Bookmark, Person, Settings , MoreVert} from '@mui/icons-material'
import React, { useContext , useState , useRef , useEffect } from 'react'
import './sidebar.css'
import { Link , useNavigate } from 'react-router-dom'
import { AuthContext } from '../../state/AuthContext';

export default function Sidebar() {
  const PUBLIC_FOLDER= process.env.REACT_APP_PUBLIC_FOLDER;
  const {user , dispatch} = useContext(AuthContext);
  const [showMenu, setShowMenu] = useState(false);
  const navigate = useNavigate();
  const menuRef = useRef(null);
  
  const handleLogout = () => {
    // AuthContext に dispatch があれば使う
    try {
      if (dispatch) dispatch({ type: "LOGOUT" });
    } catch (e) {
      console.error("logout dispatch error", e);
    }
    // ローカルストレージもクリア
    try { 
        localStorage.removeItem("user"); 
    } catch (e) {
        console.error("localStorage clear error", e);
    }
    // ログイン画面へ遷移
    window.location.reload();
    navigate("/login");
  }

  const toggleMenu = (e) => {
    e.stopPropagation();
    setShowMenu(prev => !prev);
  }

  useEffect(() => {
    const handleClickOutSide = (e) => {
        if (menuRef.current && !menuRef.current.contains(e.target)) {
            setShowMenu(false);
        }
    };
    document.addEventListener("click", handleClickOutSide);
    return ()=> document.removeEventListener("click", handleClickOutSide);
  },[]);
  
  return (
    <div className='sidebar'>
        <div className="sidebarWrapper">
            <ul className="sidebarList">
                <li className="sidebarListItem">
                    <Link to="/" style={{textDecoration:"none", color:"inherit"}}>
                        <Home className='sidebarIcon'/>
                    </Link>
                    <Link to="/" style={{textDecoration:"none", color:"inherit"}}>
                        <span className='sidebarListItemText'>
                            Home
                        </span>
                    </Link>
                </li>
                {/* <li className="sidebarListItem">
                    <Search className='sidebarIcon'/>
                    <span className='sidebarListItemText'>
                        Explore
                    </span>
                </li> */}
                <li className="sidebarListItem">
                    <Notifications className='sidebarIcon'/>
                    <span className='sidebarListItemText'>
                        Notifications
                    </span>
                </li>
                <li className="sidebarListItem">
                   <MessageRounded className='sidebarIcon'/>
                    <span className='sidebarListItemText'>
                        Messages
                    </span>
                </li>
                <li className="sidebarListItem">
                    <Bookmark className='sidebarIcon'/>
                    <span className='sidebarListItemText'>
                        Bookmarks
                    </span>
                </li>
                {user && (
                <li className="sidebarListItem">
                    <Link to={`/profile/${user.username}`} style={{textDecoration:"none", color:"inherit"}}>
                        <Person className='sidebarIcon'/>
                    </Link>
                    <Link to={`/profile/${user.username}`} style={{textDecoration:"none", color:"inherit"}}>
                        <span className='sidebarListItemText'>
                            Profile
                        </span>
                    </Link>
                </li>
                )}
                <li className="sidebarListItem">
                    <Settings className='sidebarIcon'/>
                    <span className='sidebarListItemText'>
                        Settings
                    </span>
                </li>
                <hr className="sidebarHr" />
                {user && (
                <ul className="sidebarFriendList">
                    <li className="sidebarFriend">
                        <img src={
                            user.profilePicture?.startsWith("http") 
                            ? user.profilePicture 
                            : PUBLIC_FOLDER + "person/noAvatar.png"
                        }
                        alt="" 
                        className='sidebarFriendImg'
                        />
                        <span className="sidebarFriendName">
                            {user.username}
                        </span>
                        <div className="userMoreWrapper" ref={menuRef} >
                            <div onClick={toggleMenu} role="button" tabIndex={0} onKeyDown={(e)=>{ if(e.key === 'Enter' || e.key === ' ') toggleMenu(e); }}>
                                <MoreVert className="UsersMore"/>
                            </div>
                            {showMenu && (
                                <div className="userMenu" onClick={(e)=>e.stopPropagation()}>
                                 <button className="logoutBtn" onClick={handleLogout}>Logout</button>
                                </div>
                            )}
                        </div>
                    </li>
                </ul>
                )}
            </ul>
        </div>

    </div>
  )
}

