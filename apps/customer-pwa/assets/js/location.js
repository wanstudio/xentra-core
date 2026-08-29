window.XentraLocation = {

    getCurrentPosition(){

        return new Promise((resolve, reject)=>{


            if(!navigator.geolocation){

                reject({
                    message:"GPS tidak tersedia"
                });

                return;

            }


            navigator.geolocation.getCurrentPosition(

                (position)=>{

                    resolve({

                        lat: position.coords.latitude,

                        lng: position.coords.longitude,

                        accuracy: position.coords.accuracy

                    });


                },


                (error)=>{

                    reject({

                        message:error.message

                    });

                },


                {
                    enableHighAccuracy:true,
                    timeout:10000,
                    maximumAge:0
                }

            );


        });

    }

};