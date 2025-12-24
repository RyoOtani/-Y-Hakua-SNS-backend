import axios from "axios";

export const loginCall = async (user , dispatch) => {
    dispatch({type:"LOGIN_START"});
    try {
        const response = await axios.post("auth/login" , user);
        // レスポンスにトークンが含まれていると仮定
        if (response.data.token) {
            localStorage.setItem("token", response.data.token);
            axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;
        }
        dispatch ({type:"LOGIN_SUCCESS" , payload:response.data});
    } catch (err) {
        dispatch ({type:"LOGIN_ERROR" , payload:err});
    }
}