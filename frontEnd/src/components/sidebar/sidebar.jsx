import { Home, Notifications, MessageRounded, Person, Settings, MoreVert, TrendingUp } from '@mui/icons-material'
import React, { useContext, useState, useRef, useEffect } from 'react'
import './sidebar.css'
import { Link, useNavigate } from 'react-router-dom'
import { AuthContext } from '../../state/AuthContext';
import axios from 'axios';

export default function Sidebar() {
    const PUBLIC_FOLDER = process.env.REACT_APP_PUBLIC_FOLDER || "/assets/";
    const { user, dispatch } = useContext(AuthContext);
    const [showMenu, setShowMenu] = useState(false);
    const navigate = useNavigate();
    const menuRef = useRef(null);

    const handleLogout = async () => {
        try {
            await axios.get("/api/auth/logout", { withCredentials: true });
            // Clear token from localStorage
            localStorage.removeItem('token');
            // Clear Authorization header from axios defaults
            delete axios.defaults.headers.common['Authorization'];

            if (dispatch) {
                dispatch({ type: "LOGOUT" });
            }
            // Redirect to login page
            window.location.href = "/login";
        } catch (err) {
            console.error("Logout failed:", err);
        }
    };

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
        return () => document.removeEventListener("click", handleClickOutSide);
    }, []);

    return (
        <div className='sidebar'>
            <div className="sidebarWrapper">
                <ul className="sidebarList">
                    <li className="sidebarListItem">
                        <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
                            <Home className='sidebarIcon' />
                        </Link>
                        <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
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
                        <Link to="/notifications" style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", width: "100%" }}>
                            <Notifications className='sidebarIcon' />
                            <span className='sidebarListItemText'>
                                Notifications
                            </span>
                        </Link>
                    </li>
                    <li className="sidebarListItem">
                        <Link to="/messenger" style={{ textDecoration: "none", color: "inherit" }}>
                            <MessageRounded className='sidebarIcon' />
                        </Link>
                        <Link to="/messenger" style={{ textDecoration: "none", color: "inherit" }}>
                            <span className='sidebarListItemText'>
                                Messages
                            </span>
                        </Link>
                    </li>
                    <li className="sidebarListItem">
                        <Link to="/ranking" style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", width: "100%" }}>
                            <TrendingUp className='sidebarIcon' />
                            <span className='sidebarListItemText'>
                                Ranking
                            </span>
                        </Link>
                    </li>
                    {user && (
                        <li className="sidebarListItem">
                            <Link to={`/profile/${user.username}`} style={{ textDecoration: "none", color: "inherit" }}>
                                <Person className='sidebarIcon' />
                            </Link>
                            <Link to={`/profile/${user.username}`} style={{ textDecoration: "none", color: "inherit" }}>
                                <span className='sidebarListItemText'>
                                    Profile
                                </span>
                            </Link>
                        </li>
                    )}
                    <li className="sidebarListItem">
                        <Link to="/setting" style={{ textDecoration: "none", color: "inherit" }}>
                            <Settings className='sidebarIcon' />
                        </Link>
                        <Link to="/setting" style={{ textDecoration: "none", color: "inherit" }}>
                            <span className='sidebarListItemText'>
                                Settings
                            </span>
                        </Link>
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
                                    <div onClick={toggleMenu} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleMenu(e); }}>
                                        <MoreVert className="UsersMore" />
                                    </div>
                                    {showMenu && (
                                        <div className="userMenu" onClick={(e) => e.stopPropagation()}>
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

